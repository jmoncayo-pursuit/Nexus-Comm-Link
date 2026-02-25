import http from 'http';
const ports = [9000];
async function check() {
    for (const port of ports) {
        try {
            const res = await new Promise((resolve, reject) => {
                const req = http.get(`http://127.0.0.1:${port}/json/version`, resolve);
                req.on('error', reject);
                req.setTimeout(1000, () => req.destroy(new Error('timeout')));
            });
            console.log(`Port ${port} response: ${res.statusCode}`);
        } catch (e) {
            console.log(`Port ${port} error: ${e.message}`);
        }
    }
}
check();
