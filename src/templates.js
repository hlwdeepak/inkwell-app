// Built-in responsive HTML email templates & rendering engine

function wrapInHtmlBoilerplate({ title, content, footerHtml, openPixel }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title || 'Inkwell Message'}</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #f6f8fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .email-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .btn { display: inline-block; padding: 12px 24px; background-color: #10b981; color: #ffffff !important; text-decoration: none; font-weight: 600; border-radius: 6px; }
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; border-radius: 0 !important; }
      .content-padding { padding: 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f6f8fa;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center">
        <div class="email-container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
          ${content}
          <!-- CAN-SPAM & GDPR Footer -->
          <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.6;">
            ${footerHtml}
          </div>
        </div>
        ${openPixel ? `<img src="${openPixel}" width="1" height="1" style="display:none;width:1px;height:1px;" alt="" />` : ''}
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const TEMPLATES = {
  newsletter: {
    name: 'Modern Announcement / Newsletter',
    render: ({ headline, body, ctaText, ctaUrl, companyName }) => `
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 28px; text-align: center;">
        <span style="display:inline-block; font-size: 13px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;">${companyName || 'Inkwell Update'}</span>
        <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; line-height: 1.3;">${headline || 'Important Update'}</h1>
      </div>
      <div class="content-padding" style="padding: 32px 28px; color: #334155; font-size: 15px; line-height: 1.7;">
        ${body || '<p>Hey {{first_name}}, here is your latest update!</p>'}
        ${ctaText && ctaUrl ? `
          <div style="text-align: center; margin: 32px 0 16px 0;">
            <a href="${ctaUrl}" class="btn" style="display: inline-block; padding: 12px 28px; background-color: #0f766e; color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 6px;">${ctaText}</a>
          </div>
        ` : ''}
      </div>
    `
  },
  deal: {
    name: 'Promotional Offer / Launch',
    render: ({ headline, body, ctaText, ctaUrl, badgeText }) => `
      <div style="padding: 24px 28px 0 28px; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; background-color: #fef3c7; color: #b45309; font-size: 12px; font-weight: 700; border-radius: 20px; text-transform: uppercase; letter-spacing: 1px;">
          ${badgeText || 'Special Exclusive'}
        </span>
        <h1 style="margin: 16px 0 8px 0; color: #0f172a; font-size: 26px; font-weight: 800; line-height: 1.25;">${headline || 'Exclusive Offer Just For You'}</h1>
      </div>
      <div class="content-padding" style="padding: 20px 28px 32px 28px; color: #334155; font-size: 15px; line-height: 1.7;">
        ${body || '<p>Hi {{first_name}}, check out our newest release.</p>'}
        ${ctaText && ctaUrl ? `
          <div style="text-align: center; margin: 28px 0 10px 0;">
            <a href="${ctaUrl}" class="btn" style="display: inline-block; padding: 14px 32px; background-color: #e11d48; color: #ffffff; text-decoration: none; font-weight: 700; border-radius: 6px; font-size: 16px;">${ctaText}</a>
          </div>
        ` : ''}
      </div>
    `
  },
  minimal: {
    name: 'Clean Personal Letter',
    render: ({ body, senderName }) => `
      <div class="content-padding" style="padding: 36px 32px; color: #1e293b; font-size: 16px; line-height: 1.75;">
        ${body || '<p>Hi {{first_name}},</p><p>Wanted to drop a personal note.</p>'}
        <p style="margin-top: 28px; font-weight: 600; color: #0f172a;">— ${senderName || 'The Team'}</p>
      </div>
    `
  },
  custom: {
    name: 'Raw / Custom HTML',
    render: ({ html }) => html || '<div style="padding: 24px;">{{first_name}}</div>'
  }
};

function buildEmailHtml({ templateType = 'newsletter', data = {}, footer, openPixel }) {
  const tpl = TEMPLATES[templateType] || TEMPLATES.newsletter;
  const innerContent = tpl.render(data);
  return wrapInHtmlBoilerplate({
    title: data.headline || data.subject,
    content: innerContent,
    footerHtml: footer,
    openPixel
  });
}

function htmlToPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<style([\s\S]*?)<\/style>/gi, '')
    .replace(/<script([\s\S]*?)<\/script>/gi, '')
    .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  TEMPLATES,
  buildEmailHtml,
  htmlToPlainText
};
