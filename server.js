const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const allowedOrigins = (process.env.CORS_ORIGINS || [
  'https://assignpros.com',
  'https://www.assignpros.com',
  'https://messages.assignpros.com',
  'https://securityassignments.com',
  'https://www.securityassignments.com',
  'http://localhost:4200',
  'https://localhost:4200',
  'http://localhost:4300'
].join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (
      origin.endsWith('.assignpros.com') ||
      origin.endsWith('.securityassignments.com')
    ) {
      return callback(null, true);
    }
    console.log(`Blocked CORS origin: ${origin}`);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
};

// Manual OPTIONS handler for preflight requests
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    return res.sendStatus(200);
  }
  next();
});

app.use(cors(corsOptions));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const captchaVerifyUrl = process.env.CAPTCHA_VERIFY_URL || 'https://www.google.com/recaptcha/api/siteverify';
const captchaSecretKey = process.env.CAPTCHA_SECRET_KEY || (process.env.NODE_ENV === 'production' ? '' : '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe');
const skipCaptcha = process.env.SKIP_CAPTCHA === 'true';

const smsEndpointUrl = process.env.SMS_ENDPOINT_URL || '';
const smsEndpointMethod = (process.env.SMS_ENDPOINT_METHOD || 'GET').toUpperCase();
const smsAlertPhone = process.env.ALERT_SMS_PHONE || '';
const smsAlertMessage = process.env.SMS_ALERT_MESSAGE || 'New SecurityAssignments lead request. Check your inbox.';
const smsAuthHeaderName = process.env.SMS_AUTH_HEADER_NAME || 'x-internal-key';
const smsAuthHeaderValue = process.env.SMS_AUTH_HEADER_VALUE || '';
const smsEnabled = process.env.SMS_ENABLED !== 'false';
const smsProvider = (process.env.SMS_PROVIDER || '').trim().toUpperCase();
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromNumber = process.env.TWILIO_FROM_NUMBER || '';
const twilioMessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.socket?.remoteAddress || '';
}

async function verifyCaptchaToken(captchaToken, remoteIp) {
  if (skipCaptcha) {
    return { ok: true };
  }

  if (!captchaSecretKey) {
    return { ok: false, error: 'Captcha is not configured on the server.' };
  }

  if (!captchaToken) {
    return { ok: false, error: 'Captcha token is required.' };
  }

  const params = new URLSearchParams({
    secret: captchaSecretKey,
    response: captchaToken
  });

  if (remoteIp) {
    params.append('remoteip', remoteIp);
  }

  const response = await fetch(captchaVerifyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    return { ok: false, error: 'Captcha verification request failed.' };
  }

  const verifyResult = await response.json();
  if (!verifyResult.success) {
    return { ok: false, error: 'Captcha verification failed.' };
  }

  return { ok: true };
}

async function sendSmsAlert(required = false) {
  if (!smsEnabled) {
    if (required) {
      throw new Error('SMS is disabled (SMS_ENABLED=false).');
    }
    return;
  }

  if (!smsAlertPhone) {
    if (required) {
      throw new Error('SMS destination phone is not configured (ALERT_SMS_PHONE).');
    }
    return;
  }

  const useTwilioDirect = smsProvider === 'TWILIO' || (twilioAccountSid && twilioAuthToken && (twilioFromNumber || twilioMessagingServiceSid));
  if (useTwilioDirect) {
    if (!twilioAccountSid || !twilioAuthToken) {
      if (required) {
        throw new Error('Twilio credentials are not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN).');
      }
      return;
    }

    if (!twilioFromNumber && !twilioMessagingServiceSid) {
      if (required) {
        throw new Error('Twilio sender is not configured (TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID).');
      }
      return;
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const twilioParams = new URLSearchParams({
      To: smsAlertPhone,
      Body: smsAlertMessage
    });

    if (twilioMessagingServiceSid) {
      twilioParams.set('MessagingServiceSid', twilioMessagingServiceSid);
    } else {
      twilioParams.set('From', twilioFromNumber);
    }

    const twilioAuth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: twilioParams.toString()
    });

    if (!twilioResponse.ok) {
      const twilioErrorBody = await twilioResponse.text();
      throw new Error(`Twilio SMS failed (${twilioResponse.status}): ${twilioErrorBody}`);
    }

    return;
  }

  if (!smsEndpointUrl) {
    if (required) {
      throw new Error('SMS endpoint is not configured (SMS_ENDPOINT_URL).');
    }
    return;
  }

  const headers = {};
  if (smsAuthHeaderValue) {
    headers[smsAuthHeaderName] = smsAuthHeaderValue;
  }

  let requestUrl = smsEndpointUrl;
  let requestBody;

  if (smsEndpointMethod === 'GET') {
    const url = new URL(smsEndpointUrl);
    url.searchParams.set('message', smsAlertMessage);
    url.searchParams.set('phone', smsAlertPhone);
    requestUrl = url.toString();
  } else {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify({
      message: smsAlertMessage,
      phone: smsAlertPhone
    });
  }

  const smsResponse = await fetch(requestUrl, {
    method: smsEndpointMethod,
    headers,
    body: requestBody
  });

  if (!smsResponse.ok) {
    const responseBody = await smsResponse.text();
    throw new Error(`SMS endpoint failed (${smsResponse.status}): ${responseBody}`);
  }
}

// Serve static files from the Angular app
app.use(express.static(path.join(__dirname, 'dist/assignpros-homesite')));

async function handleSendEmailRequest(req, res, requireSms) {
  const payload = typeof req.body === 'string'
    ? { notes: req.body, type: 'contact' }
    : (req.body || {});

  const {
    name = '',
    email = '',
    phone = '',
    company = '',
    notes = '',
    captchaToken = '',
    type = 'contact',
    companyName = '',
    contactInfo = '',
    addr1 = '',
    addr2 = '',
    city = '',
    state = '',
    zip = ''
  } = payload;

  const smtpHost = process.env.SMTP_HOST || 'mail.assignpros.com';
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER || 'noreply@assignpros.com';
  const smtpPass = process.env.SMTP_PASS || 'KeRe2023#$ecure';

  let transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  let mailOptions;

  if (type === 'trial') {
    mailOptions = {
      from: smtpUser,
      to: 'ken.rector@assignpros.com,phill.shaw@assignpros.com,josh.rector@assignpros.com,info@assignpros.com',
      subject: 'Trial Request from Website',
      text: `Type: ${type}\nCompany Name: ${companyName}\nContact Info: ${contactInfo}\nAddress 1: ${addr1}\nAddress 2: ${addr2}\nCity: ${city}\nState: ${state}\nZip: ${zip}\nEmail: ${email}\nPhone: ${phone}`
    };
  } else {
    mailOptions = {
      from: smtpUser,
      to: 'ken.rector@assignpros.com,phill.shaw@assignpros.com,josh.rector@assignpros.com,info@assignpros.com',
      subject: 'Information Request from Website',
      text: `Name: ${name}\nPhone: ${phone}\nEmail: ${email}\nCompany: ${company}\nNotes: ${notes}`
    };
  }

  try {
    const captchaCheck = await verifyCaptchaToken(captchaToken, getRequestIp(req));
    if (!captchaCheck.ok) {
      return res.status(400).send(captchaCheck.error);
    }

    const info = await transporter.sendMail(mailOptions);

    if (requireSms) {
      await sendSmsAlert(true);
      return res.status(200).send('Email and SMS sent: ' + info.response);
    }

    try {
      await sendSmsAlert();
    } catch (smsError) {
      console.error('SMS alert failed:', smsError);
    }

    res.status(200).send('Email sent: ' + info.response);
  } catch (error) {
    const failurePrefix = requireSms ? 'Email/SMS send failed' : 'Email send failed';
    res.status(500).send(`${failurePrefix}: ${error.message || error.toString()}`);
  }
}

app.post('/send-email', async (req, res) => {
  await handleSendEmailRequest(req, res, false);
});

app.post('/send-email-sms', async (req, res) => {
  await handleSendEmailRequest(req, res, true);
});

// Catch all other routes and return the index file
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/assignpros-homesite/index.html'));
});

app.listen(port, () => {
  console.log(`Email backend listening on port ${port}`);
});