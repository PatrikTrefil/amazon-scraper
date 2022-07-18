/**
 * This template is a production ready boilerplate for developing with `CheerioCrawler`.
 * Use this to bootstrap your projects using the most up-to-date code.
 * If you're looking for examples or want to learn more, see README.
 */

import Apify from "apify";
import handleProduct from "./routes/handleProduct";
import handleStart from "./routes/handleStart";

const {
    utils: { log },
} = Apify;

Apify.main(async () => {
    const { keyword } = (await Apify.getInput()) as { keyword?: string };
    if (keyword === undefined) throw new Error("Specify keyboard in input.");

    const startURL = new URL(
        "https://www.amazon.com/s/ref=nb_sb_noss?url=search-alias%3Daps"
    );
    startURL.searchParams.set("field-keywords", keyword);

    const requestQueue = await Apify.openRequestQueue();
    await requestQueue.addRequest({
        url: startURL.toString(),
        userData: { label: "START", keyword },
    });

    const proxyConfiguration = await Apify.createProxyConfiguration();

    const crawler = new Apify.PlaywrightCrawler({
        requestQueue,
        proxyConfiguration,
        // Be nice to the websites.
        // Remove to unleash full power.
        maxConcurrency: 50,
        handlePageFunction: async ({ request, page }) => {
            const {
                url,
                userData: { label },
            } = request;
            log.info("Page opened.", { label, url });
            switch (label) {
                case "START":
                    return handleStart({ request, page }, requestQueue);
                case "PRODUCT":
                    return handleProduct({ request, page });
                default:
                    throw new Error("Received a request without a label.");
            }
        },
    });

    log.info("Starting the crawl.");
    await crawler.run();
    log.info("Crawl finished.");

    if (Apify.isAtHome()) await notifyUserAboutResults(keyword);
});

/**
 * send e-mail to user with link to dataset
 * @param keyword what was the search based on
 */
async function notifyUserAboutResults(keyword: string) {
    const dataset = await Apify.openDataset();
    const { id } = (await dataset.getInfo()) as { id: string };

    const email = "patrik.trefil@apify.com";
    log.info(`Sending notification mail to ${email}`);

    await Apify.call("apify/send-mail", {
        to: email,
        subject: `Offers for ${keyword}`,
        text: `Link to results: ${getLinkToDataset(id)}`,
    });
}

function getLinkToDataset(id: string) {
    return `https://console.apify.com/storage/dataset/${id}`;
}
