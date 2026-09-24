import { NodeSSH } from 'node-ssh';
const ssh = new NodeSSH();

async function deploy() {
    try {
        console.log('Connecting to 192.168.1.158 (the REAL IP)...');
        await ssh.connect({
            host: '192.168.1.158',
            username: 'juanes',
            password: '5584',
            tryKeyboard: true,
            readyTimeout: 20000
        });
        
        console.log('Connected! Discovering ATLAS directory...');
        const remoteDir = '/home/juanes/ATLAS';
        
        console.log('Uploading .env...');
        await ssh.putFile('.env', `${remoteDir}/.env`);
        
        console.log('Uploading src/ai/qwen.js...');
        await ssh.putFile('src/ai/qwen.js', `${remoteDir}/src/ai/qwen.js`);
        
        console.log('Uploading src/ai/tools.js...');
        await ssh.putFile('src/ai/tools.js', `${remoteDir}/src/ai/tools.js`);
        
        console.log('Restarting PM2...');
        const restartResult = await ssh.execCommand('pm2 restart atlas');
        console.log(restartResult.stdout);
        
        console.log('Deploy FINISHED!');
        process.exit(0);
    } catch (e) {
        console.error('DEPLOY FAILED:', e);
        process.exit(1);
    }
}

deploy();
