import CDP from 'chrome-remote-interface';

async function test() {
    let client;
    try {
        client = await CDP({ port: 9000 });
        const { DOM, Runtime } = client;
        await DOM.enable();
        const root = await DOM.getDocument();
        const { nodeId } = await DOM.querySelector({ nodeId: root.root.nodeId, selector: 'input[type="file"]' });
        console.log("File input nodeId:", nodeId);

        // Also evaluate if there's any file input
        const res = await Runtime.evaluate({ expression: 'document.querySelectorAll("input[type=file]").length' });
        console.log("File inputs found:", res.result.value);

    } catch (err) {
        console.error("Error:", err);
    } finally {
        if (client) {
            await client.close();
        }
    }
}
test();
