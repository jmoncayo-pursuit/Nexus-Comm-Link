const fs = require('fs');
const path = require('path');
const serverPath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverPath, 'utf8');

// Collect errors in captureSnapshot
const findLoop = "for (const ctx of cdp.contexts) {";
const replaceLoop = "let firstError = null; for (const ctx of cdp.contexts) {";
content = content.replace(findLoop, replaceLoop);

const findValError = "if (val.error) {";
const replaceValError = "if (val.error) { firstError = firstError || val; ";
content = content.replace(findValError, replaceValError);

const findReturnNull = "return null;";
const replaceReturnNull = "return firstError;";
content = content.replace(findReturnNull, replaceReturnNull);

fs.writeFileSync(serverPath, content);
console.log('Applied error-forwarding patch');
