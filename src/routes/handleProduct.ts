import Apify from "apify";
import { Page } from "playwright";

const {
    utils: { log },
} = Apify;

declare let $: JQueryStatic; // Make sure to use this only within browser context with jQuery loaded

// #region TS types

type Nullable<T> = T | null;
/**
 * if a property is missing, it means it has not been scraped yet
 * if a property equals null, it means it was not found
 */
type SharedOfferData = {
    itemUrl?: Nullable<string>;
    keyword?: Nullable<string>;
    title?: Nullable<string>;
    description?: Nullable<string>;
    asin?: Nullable<string>;
};
/**
 * if a property is missing, it means it has not been scraped yet
 * if a property equals null, it means it was not found
 */
type NonSharedOfferData = {
    offer?: Nullable<string>;
    "seller name"?: Nullable<string>;
};
/**
 * if a property is missing, it means it has not been scraped yet
 * if a property equals null, it means it was not found
 */
type Offer = SharedOfferData & NonSharedOfferData;

// #endregion

export default async function handleProduct({
    request,
    page,
}: {
    request: Apify.Request;
    page: Page;
}) {
    log.debug(`[${request.userData.label}] Handling: ${request.url}`);

    // TODO: detect captcha - if detected -> throw error

    await addJQuery(page);

    await page.waitForLoadState("load");

    let sharedData: SharedOfferData;
    try {
        sharedData = await page.evaluate(getSharedData, {
            itemUrl: request.url,
            keyword: request.userData.keyword,
        });
    } catch (e) {
        if (e instanceof Error) await reportUnexpectedHtml(request, page, e);
        throw e;
    }

    let mainOffer: Nullable<Offer>;
    try {
        mainOffer = await page.evaluate(getMainOffer, { sharedData });
    } catch (e) {
        if (e instanceof Error)
            await reportUnexpectedHtml(request, page, e as Error);
        throw e;
    }

    let otherOffers: Offer[];
    try {
        otherOffers = await getOtherOffers(page, sharedData);
    } catch (e) {
        if (e instanceof Error)
            await reportUnexpectedHtml(request, page, e as Error);
        throw e;
    }

    const resultOffers: Offer[] = [];

    if (mainOffer !== null) resultOffers.push(mainOffer as Offer);
    resultOffers.push(...otherOffers);

    log.info(`Data for ${request.url}: `, resultOffers);

    const mainOfferMissingProperties: string[] =
        mainOffer !== null ? getMissingProperties(mainOffer as Offer)[0] : [];

    const otherOffersMissingProperties: string[][] = getMissingProperties(
        ...otherOffers
    );

    // if at least one offer is missing at least one property we report
    if (
        mainOfferMissingProperties.length > 0 ||
        otherOffersMissingProperties.filter((item) => item.length > 0).length >
            0
    ) {
        await reportMissingProperties(
            request,
            mainOfferMissingProperties,
            otherOffersMissingProperties,
            page
        );
    }

    const dataset = await Apify.openDataset();
    await dataset.pushData(resultOffers);
}

/**
 * @returns a list of lists, where each list consists of names of all properties, whose value equals null
 */
function getMissingProperties(...objs: object[]): string[][] {
    const missingProperties = new Array(objs.length);

    for (let i = 0; i < missingProperties.length; i++)
        missingProperties[i] = [];

    for (const [i, obj] of objs.entries()) {
        // eslint-disable-next-line no-restricted-syntax
        for (const property in obj)
            if (obj[property as keyof typeof obj] === null)
                missingProperties[i].push(property);
    }

    return missingProperties;
}

/**
 * get all shared data from product page
 */
function getSharedData({
    itemUrl,
    keyword,
}: {
    itemUrl: string;
    keyword: string;
}) {
    const sharedData: SharedOfferData = {
        itemUrl,
        keyword,
    };

    // there are two possible tags which can hold the product title
    const titleEl1 = $("#title");
    if (titleEl1.length === 1) sharedData.title = titleEl1.text().trim();
    else if (titleEl1.length === 0) {
        const titleEl2 = $("div[data-cel-widget='Title']");

        if (titleEl2.length === 0) sharedData.title = null;
        else if (titleEl2.length === 1)
            sharedData.title = titleEl2.text().trim();
        else throw new Error("Found too many title elements");
    } else {
        throw new Error("Found too many title elements");
    }

    const productDescriptionEl = $("#productDescription");
    if (productDescriptionEl.length === 0) sharedData.description = null;
    else if (productDescriptionEl.length === 1)
        sharedData.description = productDescriptionEl.text().trim();
    else throw new Error("Found too many descriptions");

    const detailsTbody = $("#productDetails_detailBullets_sections1");
    if (detailsTbody.length === 0) {
        sharedData.asin = null;
    } else if (detailsTbody.length === 1) {
        const ths = $("th", detailsTbody);
        let asinTh;
        for (let i = 0; i < ths.length; i++) {
            const element = $(ths[i]);
            const text = element.text().trim();
            if (text === "ASIN") {
                asinTh = element;
                break;
            }
        }
        if (asinTh === undefined) {
            sharedData.asin = null;
        } else {
            const asinTd = $(asinTh).siblings("td");
            if (asinTd.length === 1)
                sharedData.asin = $(asinTd[0]).text().trim();
            else
                throw new Error(
                    "Found row with th, which has text 'ASIN', but couldn't find td with actual value (either there are no td tags in the same row or there is more than one)"
                );
        }
    } else throw new Error("Found too many details table bodies");

    return sharedData;
}

/**
 * get main offer from product page
 * @returns null if the product is currently unavailable or the main offer if the product is available
 */
function getMainOffer({ sharedData }: { sharedData: SharedOfferData }) {
    // we have to check 2 tags to see if the item is currently unavailable
    const availability1 = $("div[cel_widget_id='Availability']");
    if (availability1.length > 0) return null; // availability.length > 0 => Currently unavailable

    const availability2 = $("#availability span");
    if (availability2.text() === "Currently unavailable.") return null;

    const mainOffer: Offer = { ...sharedData };

    const sellerNameEl = $(
        "#tabular-buybox .tabular-buybox-container div.tabular-buybox-text[tabular-attribute-name='Sold by']"
    );
    if (sellerNameEl.length === 0) mainOffer["seller name"] = null;
    else if (sellerNameEl.length === 1)
        mainOffer["seller name"] = sellerNameEl.text().trim();
    else throw new Error("Found too many seller names for main offer");

    // sometimes there are more elements, then we use offerEl2
    const offerEl1 = $("#corePrice_desktop span.a-price span.a-offscreen");
    if (offerEl1.length === 0) mainOffer.offer = null;
    else if (offerEl1.length === 1) mainOffer.offer = offerEl1.text().trim();
    else {
        const offerEl2 = $(
            "#newAccordionRow #corePrice_feature_div span.a-offscreen"
        );
        if (offerEl2.length === 0 || offerEl2.length > 1)
            throw new Error("Unexpected pricing HTML");
        mainOffer.offer = offerEl2.text().trim();
    }

    return mainOffer;
}

/**
 * get other offers from product page
 * make sure to open the sidebar with other offers before calling this method
 * @returns list of offers found in the open sidebar
 */
async function getOtherOffers(page: Page, sharedData: SharedOfferData) {
    const otherOffersLink = await page.$$("#olpLinkWidget_feature_div a");
    if (otherOffersLink.length === 0) return [];
    if (otherOffersLink.length > 1)
        throw new Error("Found too many other offers links");

    await otherOffersLink[0].click(); // open other offers sidebar

    await page.waitForSelector("#aod-offer-list");

    const otherOffers = await page.evaluate(
        async ({ sharedOfferData }: { sharedOfferData: SharedOfferData }) => {
            const offers: Offer[] = [];

            const offerContainerEls = $("#aod-offer-list > div");
            offerContainerEls.each((i, offerContainerEl) => {
                const currOfferPriceEl = $(
                    `#aod-price-${i + 1} span.a-offscreen`,
                    offerContainerEl
                );
                let currOffer: Nullable<string>;
                if (currOfferPriceEl.length === 0) currOffer = null;
                else if (currOfferPriceEl.length === 1)
                    currOffer = currOfferPriceEl.text().trim();
                else throw new Error("Found more than one offer");

                const offerSellerEl = $(
                    "#aod-offer-soldBy a",
                    offerContainerEl
                );
                let currOfferSoldBy: Nullable<string>;
                if (offerSellerEl.length === 0) currOfferSoldBy = null;
                else if (offerSellerEl.length === 1)
                    currOfferSoldBy = offerSellerEl.text().trim();
                else throw new Error("Found more then one seller of an offer");

                offers.push({
                    ...sharedOfferData,
                    offer: currOffer,
                    "seller name": currOfferSoldBy,
                });
            });
            return offers;
        },
        { sharedOfferData: sharedData }
    );
    return otherOffers;
}

async function reportMissingProperties(
    request: Apify.Request,
    mainOfferMissingProperties: string[],
    otherOffersMissingProperties: string[][],
    page: Page
) {
    const snapshotKey = `HTML-PROPERTY-NOT-FOUND-${request.id}`;
    await Apify.setValue(snapshotKey, await page.content(), {
        contentType: "text/html",
    });
    const reportingDataset = await Apify.openDataset("REPORTING");

    let htmlSnapshotLocation: string;
    if (Apify.isAtHome())
        htmlSnapshotLocation = getDefaultCloudKeyValueStoreLocation(
            snapshotKey,
            ".html"
        );
    else {
        htmlSnapshotLocation = getDefaultLocalKeyValueStoreItemLocation(
            snapshotKey,
            ".html"
        );
    }

    await reportingDataset.pushData({
        label: "MISSING-PROPERTY",
        productPageUrl: request.url,
        mainOfferMissingProperties,
        otherOffersMissingProperties,
        htmlSnapshotLocation,
    });
}

/**
 * use this function to report requests where you find unexpected
 * elements on a webpage or don't find expected elements
 */
async function reportUnexpectedHtml(
    request: Apify.Request,
    page: Page,
    error: Error
) {
    const snapshotKey = `UNEXPECTED-HTML-${request.id}`;
    await Apify.setValue(snapshotKey, await page.content(), {
        contentType: "text/html",
    });
    let htmlSnapshotLocation: string;
    if (Apify.isAtHome())
        htmlSnapshotLocation = getDefaultCloudKeyValueStoreLocation(
            snapshotKey,
            ".html"
        );
    else {
        htmlSnapshotLocation = getDefaultLocalKeyValueStoreItemLocation(
            snapshotKey,
            ".html"
        );
    }

    const reportingDataset = await Apify.openDataset("REPORTING");
    await reportingDataset.pushData({
        label: "UNEXPECTED-HTML",
        productPageUrl: request.url,
        htmlSnapshotLocation,
        errorMessage: error.message,
    });
}

async function addJQuery(page: Page) {
    await page.addScriptTag({
        url: "https://code.jquery.com/jquery-3.6.0.min.js",
    });
}

/**
 * @returns the location (file path) of a file representing the itemKey in default value store
 */
function getDefaultLocalKeyValueStoreItemLocation(
    itemKey: string,
    itemExtension = ".json"
) {
    let location: string;
    const env = Apify.getEnv();

    if ("APIFY_LOCAL_STORAGE_DIR" in env)
        location = `${
            (env as typeof env & { APIFY_LOCAL_STORAGE_DIR: string })
                .APIFY_LOCAL_STORAGE_DIR
        }`;
    else location = "./apify_storage/";

    location += `key_value_stores/${itemKey}${itemExtension}`;
    return location;
}

/**
 * @returns the location (url) of a file representing the itemKey in default value store
 */
function getDefaultCloudKeyValueStoreLocation(
    itemKey: string,
    itemExtension = ".json"
) {
    const storeId = Apify.getEnv().defaultKeyValueStoreId;
    return `https://api.apify.com/v2/key-value-stores/${storeId}/records/${itemKey}${itemExtension}?disableRedirect=true`;
}
