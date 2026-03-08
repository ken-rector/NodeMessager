# NodeMessager Setup Guide (Windows Server / IIS + NSSM)

NodeMessager is a Node.js backend that handles contact/demo request form submissions from websites. It sends email via SMTP and optional SMS alerts via Twilio. IIS acts as a reverse proxy to the Node process, which is hosted as a Windows service via NSSM.

---

## Prerequisites

Install all of the following before proceeding:

- **Windows Server** (2016 or newer recommended)
- **Node.js** (v18+ recommended) — https://nodejs.org/
- **IIS** with the following features enabled:
  - Static Content
  - Default Document
  - URL Rewrite Module — https://www.iis.net/downloads/microsoft/url-rewrite
  - **Application Request Routing (ARR)** — https://www.iis.net/downloads/microsoft/application-request-routing
- **NSSM** (Non-Sucking Service Manager) — https://nssm.cc/download  
  Extract `nssm.exe` (64-bit) to a folder in your PATH, e.g. `C:\Tools\nssm\`

---

## 1. Deploy the Project Files

Copy the project files to the server, or clone from Git:

```
git clone https://github.com/ken-rector/NodeMessager.git C:\MyApps\NodeMessager
cd C:\MyApps\NodeMessager
```

Install Node dependencies:

```
npm install
```

---

## 2. Create the .env File

Create `C:\MyApps\NodeMessager\.env` with the following keys. **Never commit this file to Git.**

```env
PORT=3000
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Set to true to bypass captcha during testing; false in production
SKIP_CAPTCHA=false

# SMS Settings (Twilio)
SMS_ENABLED=true
SMS_PROVIDER=TWILIO
ALERT_SMS_PHONE=+1XXXXXXXXXX
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+1XXXXXXXXXX
TWILIO_MESSAGING_SERVICE_SID=

# SMTP Email Settings
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS="your_smtp_password"

# Google reCAPTCHA v2
CAPTCHA_SECRET_KEY=your_recaptcha_secret_key
CAPTCHA_VERIFY_URL=https://www.google.com/recaptcha/api/siteverify
```

> **Note:** If your SMTP password contains special characters (`#`, `$`, `!`, etc.), wrap the value in double quotes as shown above. The server reads `.env` automatically on startup using `dotenv`, as long as the NSSM `AppDirectory` is set to the project folder.

---

## 3. Enable ARR Proxy in IIS

This step is required and is often missed. Without it, IIS will not forward requests to Node.

1. Open **IIS Manager**
2. Click the **server root node** (not a site) in the left panel
3. Double-click **Application Request Routing Cache**
4. In the right panel, click **Server Proxy Settings**
5. Check **Enable proxy**
6. Click **Apply**

---

## 4. Create the IIS Site

1. In IIS Manager, right-click **Sites** → **Add Website**
2. Set:
   - **Site name:** NodeMessager (or your preferred name)
   - **Physical path:** `C:\MyApps\NodeMessager`
   - **Binding:** your hostname/IP and port 80 (or 443 for HTTPS)
3. Click **OK**

The project includes a `web.config` that proxies all requests to the Node process on port 3000:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ProxyAllToNode" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3000/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

No changes to `web.config` are needed unless you change the Node port.

---

## 5. Register NodeMessager as a Windows Service (NSSM)

Open **Command Prompt as Administrator** and run:

```
nssm install NodeMessager "C:\Program Files\nodejs\node.exe" "C:\MyApps\NodeMessager\server.js"
```

Then configure the service via the NSSM GUI (it opens automatically) or run `nssm edit NodeMessager`:

| Tab | Field | Value |
|-----|-------|-------|
| Application | App Directory | `C:\MyApps\NodeMessager` |
| Details | Display name | `NodeMessager` |
| I/O | Output (stdout) | `C:\MyApps\NodeMessager\logs\stdout.log` |
| I/O | Error (stderr) | `C:\MyApps\NodeMessager\logs\stderr.log` |

> **Important:** Setting `AppDirectory` to the project folder is what allows `dotenv` to find the `.env` file automatically. Do **not** set environment variables directly in NSSM — use `.env` instead.

Create the logs folder if using log paths:

```
mkdir C:\MyApps\NodeMessager\logs
```

---

## 6. Start the Service

```
nssm start NodeMessager
```

Verify it is running:

```
nssm status NodeMessager
```

Expected output: `SERVICE_RUNNING`

---

## 7. Test the Setup

- Visit `http://yourdomain.com/health` or `http://yourdomain.com/` in a browser
- Submit a demo request form from the web app
- Confirm an email and SMS are received

You can also test the endpoint directly:

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:3000 -Method GET
```

---

## .gitignore

Ensure `.env` is excluded from Git. Your `.gitignore` should include:

```
.env
node_modules/
logs/
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Service won't start | Check `stderr.log`; verify Node path and AppDirectory |
| Email not sending | Check SMTP credentials in `.env`; quote password if it has special chars |
| SMS not sending | Verify Twilio SID, token, and phone numbers in `.env` |
| IIS returns 500 | Check ARR proxy is enabled; confirm Node is running on port 3000 |
| Captcha errors | Set `SKIP_CAPTCHA=true` for testing; ensure secret key is correct for production |
| `.env` not loaded | Confirm NSSM `AppDirectory` is set to `C:\MyApps\NodeMessager` |

---

## Useful NSSM Commands

```
nssm start NodeMessager       # Start the service
nssm stop NodeMessager        # Stop the service
nssm restart NodeMessager     # Restart the service
nssm status NodeMessager      # Check current status
nssm edit NodeMessager        # Open GUI to edit config
nssm remove NodeMessager      # Uninstall the service
```

---

## References

- [NSSM documentation](https://nssm.cc/)
- [IIS URL Rewrite Module](https://www.iis.net/downloads/microsoft/url-rewrite)
- [IIS Application Request Routing](https://www.iis.net/downloads/microsoft/application-request-routing)
- [dotenv documentation](https://github.com/motdotla/dotenv)
- [Twilio Node.js Quickstart](https://www.twilio.com/docs/sms/quickstart/node)
