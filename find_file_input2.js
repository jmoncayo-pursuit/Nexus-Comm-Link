import fetch from 'node-fetch';
import WebSocket from 'ws';

async function test() {
    const res = await fetch('http://localhost:9000/json');
    const targets = await res.json();
    const target = targets.find(t => t.type === 'page');
    if (!target) return console.log('No CDP targets found');

    const wsParams = { ws: new WebSocket(target.webSocketDebuggerUrl), idCount: 1, cbs: {} };
    wsParams.ws.on('message', data => {
        const msg = JSON.parse(data);
        if (wsParams.cbs[msg.id]) wsParams.cbs[msg.id](msg.result);
    });

    await new Promise(r => wsParams.ws.on('open', r));

    function call(method, params) {
        return new Promise(resolve => {
            const id = wsParams.idCount++;
            wsParams.cbs[id] = resolve;
            wsParams.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    try {
        const doc = await call('DOM.getDocument', {});
        const res1 = await call('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
        console.log("File inputs nodeId array:", res1.nodeIds);

        // check if drag-and-drop is supported on chat input container
        const res2 = await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#chat' });
        console.log("Chat nodeId:", res2.nodeId);
    } catch (e) { console.error(e) }

    wsParams.ws.close();
}
test();
