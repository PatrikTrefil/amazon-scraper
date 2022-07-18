import Apify from "apify";
import { Page } from "playwright";

const {
    utils: { log },
} = Apify;

export default async function handleStart(
    { request, page }: { request: Apify.Request; page: Page },
    requestQueue: Apify.RequestQueue
) {
    await page.addScriptTag({
        url: "https://code.jquery.com/jquery-3.6.0.min.js",
    });
    await page.waitForLoadState("load");
    const productLinksToEnqueue = await page.evaluate(
        ({ requestUrl }: { requestUrl: string }) => {
            const anchorTags = $(
                ".s-main-slot div[data-component-type='s-search-result'] h2.a-size-mini a"
            );
            const absoluteLinksToEnqueue: string[] = [];
            anchorTags.each((_, a) => {
                const relativeLink = $(a).attr("href");
                if (relativeLink !== undefined) {
                    const absoluteLink = new URL(
                        relativeLink,
                        requestUrl
                    ).toString();
                    absoluteLinksToEnqueue.push(absoluteLink);
                }
            });
            return absoluteLinksToEnqueue;
        },
        { requestUrl: request.url }
    );
    const productPageLabel = "PRODUCT";
    log.info(
        `[${request.userData.label}] Enqueued ${productLinksToEnqueue.length} ${productPageLabel}`
    );
    log.debug(
        `[${request.userData.label}] Enqueued the following links with label ${productPageLabel}`,
        productLinksToEnqueue
    );
    for (const absoluteLink of productLinksToEnqueue) {
        requestQueue.addRequest({
            url: absoluteLink,
            userData: {
                label: productPageLabel,
                keyword: request.userData.keyword,
            },
        });
    }
}
