(function () {
  const scriptTag = document.currentScript;
  const listId = scriptTag?.getAttribute('data-list') || new URL(scriptTag.src).searchParams.get('list_id') || 1;
  const host = new URL(scriptTag.src).origin;
  const buttonColor = scriptTag?.getAttribute('data-color') || '#0f766e';
  const title = scriptTag?.getAttribute('data-title') || 'Subscribe to our newsletter';

  const container = document.createElement('div');
  container.className = 'inkwell-embed-container';
  container.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 420px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <h3 style="margin: 0 0 8px 0; color: #0f172a; font-size: 18px; font-weight: 700;">${title}</h3>
      <p style="margin: 0 0 16px 0; color: #64748b; font-size: 13.5px;">Get updates and announcements delivered straight to your inbox.</p>
      <form id="inkwell-embed-form" style="display: flex; flex-direction: column; gap: 10px;">
        <input type="text" id="inkwell-name" placeholder="First Name (optional)" style="padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; outline: none;" />
        <input type="email" id="inkwell-email" placeholder="Your Email Address" required style="padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; outline: none;" />
        <button type="submit" id="inkwell-btn" style="padding: 11px 16px; background-color: ${buttonColor}; color: #ffffff; font-weight: 600; font-size: 14px; border: none; border-radius: 6px; cursor: pointer;">Subscribe</button>
        <div id="inkwell-msg" style="display: none; font-size: 13px; margin-top: 6px;"></div>
      </form>
    </div>
  `;

  scriptTag.parentNode.insertBefore(container, scriptTag.nextSibling);

  const form = container.querySelector('#inkwell-embed-form');
  const msg = container.querySelector('#inkwell-msg');
  const btn = container.querySelector('#inkwell-btn');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Subscribing...';
    msg.style.display = 'none';

    const email = container.querySelector('#inkwell-email').value.trim();
    const first_name = container.querySelector('#inkwell-name').value.trim();

    try {
      const res = await fetch(`${host}/api/public/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, first_name, list_id: Number(listId) })
      });
      const data = await res.json();
      if (res.ok) {
        msg.style.color = '#059669';
        msg.textContent = '✓ ' + (data.message || 'Check your inbox to confirm your subscription!');
        form.reset();
      } else {
        msg.style.color = '#dc2626';
        msg.textContent = '✕ ' + (data.error || 'Failed to subscribe. Please try again.');
      }
    } catch (err) {
      msg.style.color = '#dc2626';
      msg.textContent = '✕ Network error. Please try again.';
    } finally {
      msg.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Subscribe';
    }
  });
})();
