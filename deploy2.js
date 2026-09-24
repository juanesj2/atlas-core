import fs from 'fs';
import { NodeSSH } from 'node-ssh';
const ssh = new NodeSSH();

async function deploy() {
    try {
        console.log('Connecting to 192.168.1.161...');
        await ssh.connect({
            host: '192.168.1.161',
            username: 'juanes',
            password: '5584',
            tryKeyboard: true,
            readyTimeout: 30000
        });
        
        const remoteDir = '/home/juanes/atlas-core';
        
        console.log('Uploading .env...');
        await ssh.putFile('.env', `${remoteDir}/.env`);
        
        console.log('Uploading src/index.js...');
        await ssh.putFile('src/index.js', `${remoteDir}/src/index.js`);

        console.log('Uploading src/ai/qwen.js...');
        await ssh.putFile('src/ai/qwen.js', `${remoteDir}/src/ai/qwen.js`);
        
        console.log('Uploading src/ai/tools.js...');
        await ssh.putFile('src/ai/tools.js', `${remoteDir}/src/ai/tools.js`);

        console.log('Uploading src/skills/spotify.js...');
        await ssh.putFile('src/skills/spotify.js', `${remoteDir}/src/skills/spotify.js`);

        console.log('Ensuring directories exist...');
        await ssh.execCommand(`mkdir -p ${remoteDir}/src/services ${remoteDir}/src/skills`);

        console.log('Uploading src/services/systemStats.js...');
        await ssh.putFile('src/services/systemStats.js', `${remoteDir}/src/services/systemStats.js`);

        console.log('Uploading src/skills/system_stats.js...');
        await ssh.putFile('src/skills/system_stats.js', `${remoteDir}/src/skills/system_stats.js`);

        console.log('Uploading src/socket/satellite.js...');
        await ssh.putFile('src/socket/satellite.js', `${remoteDir}/src/socket/satellite.js`);

        console.log('Uploading public/index.html...');
        await ssh.putFile('public/index.html', `${remoteDir}/public/index.html`);

        if (fs.existsSync('public/cronos.apk')) {
            console.log('Uploading public/cronos.apk...');
            await ssh.putFile('public/cronos.apk', `${remoteDir}/public/cronos.apk`);
        }
        
        console.log('Restarting PM2...');
        const restartResult = await ssh.execCommand('pm2 restart atlas --update-env');
        console.log(restartResult.stdout);
        
        console.log('Deploy FINISHED on 192.168.1.161!');
        process.exit(0);
    } catch (e) {
        console.error('DEPLOY ERROR:', e);
        process.exit(1);
    }
}

deploy();
