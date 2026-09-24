import { NodeSSH } from 'node-ssh';
const ssh158 = new NodeSSH();
const ssh150 = new NodeSSH();

async function testSSH() {
    console.log("Probing .158...");
    try {
        await ssh158.connect({ host: '192.168.1.158', username: 'juanes', password: '5584', tryKeyboard: true });
        console.log('SUCCESS on 192.168.1.158!');
        await ssh158.execCommand('echo "Hello from 158"');
        ssh158.dispose();
    } catch(e) { console.log("Failed 158:", e.message); }

    console.log("Probing .150...");
    try {
        await ssh150.connect({ host: '192.168.1.150', username: 'juanes', password: '5584', tryKeyboard: true });
        console.log('SUCCESS on 192.168.1.150!');
        await ssh150.execCommand('echo "Hello from 150"');
        ssh150.dispose();
    } catch(e) { console.log("Failed 150:", e.message); }
}

testSSH();
