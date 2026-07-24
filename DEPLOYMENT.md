# VM Deployment Guide (Fresh Machine Setup)

This guide walks you through setting up a fresh Virtual Machine (VPS/VM) to host the bot and configure automated CD (Continuous Deployment) from GitHub.

---

## 1. System Requirements & Preparation
We recommend using **Ubuntu (22.04 LTS or 24.04 LTS)**.

Log in to your VM as a user with sudo privileges (typically `ubuntu` or `root`). 

If your server uses password authentication or a default SSH key:
```bash
ssh ubuntu@your_server_ip
```

If your server requires a specific private SSH key (recommended):
```bash
ssh -i /path/to/your-private-key.key ubuntu@your_server_ip
```

Update system packages:
```bash
sudo apt update && sudo apt upgrade -y
```

Install system utilities (git, sqlite3, curl):
```bash
sudo apt install -y git sqlite3 curl build-essential
```

---

## 2. Install Node.js (v24) using NVM
We recommend using NVM (Node Version Manager) to manage Node.js versions:

```bash
# Download and run the NVM installation script
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Load NVM into the current shell session
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install and activate Node.js 24
nvm install 24
nvm use 24
nvm alias default 24

# Verify installation (should be Node v24+)
node -v
npm -v
```

---

## 3. Clone and Setup Project Folder
1. Choose a path for your application (e.g. `/home/ubuntu/ChlenTheGameBot`):
   ```bash
   cd /home/ubuntu
   git clone https://github.com/YegorFeoktistov/Chlen-the-game.git ChlenTheGameBot
   cd ChlenTheGameBot
   ```
2. Install dependencies (devDependencies are needed for build):
   ```bash
   npm ci
   ```
3. Create and configure the environment file:
   ```bash
   cp .env.example .env
   nano .env
   ```
   *Paste your `TELEGRAM_BOT_TOKEN` here.*

4. Build the application:
   ```bash
   npm run build
   ```

---

## 4. Configure Auto-Start (Systemd Service)
We will register the bot as a system service so it automatically runs in the background and restarts on failures or server reboots.

1. Copy the example configuration to systemd folder:
   ```bash
   sudo cp chlenbot-node.service.example /etc/systemd/system/chlenbot-node.service
   ```
2. Verify paths and Node binary location inside the unit file. 
   **Note about NVM:** Since NVM installs Node in the user's home directory, the standard `/usr/bin/node` path won't work in Systemd. You must specify the absolute path to your NVM node binary.
   To find the path on the VM, run:
   ```bash
   which node
   ```
   It will output something like `/home/ubuntu/.nvm/versions/node/v24.18.0/bin/node`. Open the service file and replace the `ExecStart` path with this output:
   ```bash
   sudo nano /etc/systemd/system/chlenbot-node.service
   ```
3. Reload systemd and enable auto-run:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable chlenbot-node
   ```
4. Start the bot:
   ```bash
   sudo systemctl start chlenbot-node
   ```
5. Check if it's running and check the logs:
   ```bash
   sudo systemctl status chlenbot-node
   journalctl -u chlenbot-node -f -n 50
   ```

---

## 5. Setup CI/CD Deployment from GitHub
To enable GitHub Actions to deploy updates automatically on push to `main`:

### A. Authorize SSH connection
The GitHub runner needs to log in without password prompt.
1. Generate an SSH keypair on your local computer (if you don't have one).
2. Copy the public key into the VM's authorized file:
   ```bash
   nano ~/.ssh/authorized_keys
   ```
   *Paste the public key on a new line and save.*

### B. Configure Passwordless Restart for GitHub Action
Since the deploy workflow runs `sudo systemctl start chlenbot-node` and `sudo systemctl stop chlenbot-node`, the SSH user needs sudo permissions without password prompts.
1. Run visudo on the VM:
   ```bash
   sudo visudo
   ```
2. Append this line at the bottom of the file (replace `ubuntu` with your SSH username):
   ```text
   ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart chlenbot-node, /usr/bin/systemctl start chlenbot-node, /usr/bin/systemctl stop chlenbot-node
   ```
   *(Note: If your user already has `(ALL) NOPASSWD: ALL` in `sudo -l`, you can skip this step).*

### C. Add Secrets to GitHub Repository
Go to your repo **Settings** -> **Secrets and variables** -> **Actions** and add:
- `VM_HOST`: Server IP Address
- `VM_USER`: `ubuntu`
- `VM_SSH_KEY`: The private key matching the public key added to `authorized_keys`
- `VM_PROJECT_PATH`: `/home/ubuntu/ChlenTheGameBot`

### D. Manual Deploy / Rebuild on VM
If you ever need to trigger a manual deploy, rebuild, and restart directly from your local terminal (bypassing GitHub Actions), run:
```bash
ssh -i /path/to/key ubuntu@your_server_ip "export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\" && cd ChlenTheGameBot && git pull && sudo systemctl stop chlenbot-node && npm ci && npm run build && sudo systemctl start chlenbot-node"
```
*(Note: Loading NVM explicitly is required because non-interactive SSH shells do not load `~/.bashrc`, making `node` and `npm` commands otherwise unavailable).*

