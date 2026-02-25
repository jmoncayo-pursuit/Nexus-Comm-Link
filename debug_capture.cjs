const fs = require('fs');
const path = require('path');
const serverPath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverPath, 'utf8');

// Inject a more powerful debugger into the capture script
const debugScript = 'return { error: "debug_dump", title: document.title, bodyPrefix: document.body.innerText.substring(0, 200), html: document.body.innerHTML.substring(0, 500), iframes: Array.from(document.querySelectorAll("iframe")).map(f => f.src) };';
content = content.replace("return { error: 'chat container not found' };", debugScript);

// Update log to show this dump
content = content.replace(
    /const errorMsg = snapshot\?\.error \? .+: 'No valid snapshot captured';/,
    "const errorMsg = snapshot?.error ? 'CAPTURE_FAIL: ' + snapshot.error + ' | DATA: ' + JSON.stringify(snapshot) : 'No valid snapshot captured';"
);

fs.writeFileSync(serverPath, content);
console.log('Applied deep diagnostic patch');
