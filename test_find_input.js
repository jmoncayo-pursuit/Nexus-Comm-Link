import CDP from 'chrome-remote-interface';
async function test() {
    let client;
    try {
        client = await CDP({ port: 9000 });
        const { DOM } = client;
        await DOM.enable();
        const root = await DOM.getDocument();
        const { nodeId } = await DOM.querySelector({ nodeId: root.root.nodeId, selector: 'input[type="file"]' });
        console.log("File input nodeId:", nodeId);
    } catch (err) {
        console.error(err);
    } finally {
        if (client) {
            await client.close();
        }
    }
}
test();
