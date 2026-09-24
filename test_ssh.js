import { NodeSSH } from 'node-ssh';
const ssh = new NodeSSH();

async function setStaticNetplan() {
    await ssh.connect({ host: '192.168.1.161', username: 'juanes', password: '5584', tryKeyboard: true });
    
    const newNetplan = `# Network configuration for Cronos static IP
network:
  version: 2
  renderer: networkd
  ethernets:
    enp4s0:
      match:
        macaddress: d8:5e:d3:f7:81:60
      set-name: enp4s0
  wifis:
    wlx58044f6c942f:
      access-points:
        DIGIFIBRA-PLUS-pcgs:
          password: SpExFh2THY
      dhcp4: false
      addresses:
        - 192.168.1.161/24
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses:
          - 1.1.1.1
          - 8.8.8.8
`;

    // Write to a temporary file first
    await ssh.execCommand(`cat << 'EOF' > /tmp/static-netplan.yaml\n${newNetplan}\nEOF`);
    
    // Validate with netplan generate
    const valRes = await ssh.execCommand('echo 5584 | sudo -S cp /tmp/static-netplan.yaml /etc/netplan/00-installer-config.yaml && echo 5584 | sudo -S netplan generate');
    console.log("Validation result:", valRes.code, valRes.stdout, valRes.stderr);
    
    if (valRes.code === 0) {
        const applyRes = await ssh.execCommand('echo 5584 | sudo -S netplan apply');
        console.log("Applied netplan:", applyRes.code, applyRes.stdout, applyRes.stderr);
    } else {
        console.error("Netplan syntax check failed! Not applying.");
    }
    
    ssh.dispose();
}

setStaticNetplan();
