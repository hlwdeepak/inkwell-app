// Inkwell Pro Frontend Application

let listsCache = [];
let allTagsCache = [];
let parsedCsvRecords = [];
let currentPreviewDevice = 'desktop';

// ---- API Request Helper ----
async function api(path, options = {}) {
  const key = localStorage.getItem('inkwell_key') || '4daa819bcea2d733f4d16b9b2097bd20f7980d7f78f9a8cd';
  const headers = { 'x-api-key': key, ...options.headers };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    document.getElementById('key-setup')?.classList.remove('hidden');
    throw new Error('Invalid or missing API key.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Server error');
  return data;
}

function saveKey() {
  const key = document.getElementById('api-key').value.trim();
  if (!key) return;
  localStorage.setItem('inkwell_key', key);
  document.getElementById('key-setup').classList.add('hidden');
  loadAll();
}

function openKeyModal() {
  document.getElementById('key-setup').classList.remove('hidden');
  document.getElementById('api-key').value = localStorage.getItem('inkwell_key') || '';
}

// ---- Navigation ----
document.querySelectorAll('.nav-btn[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach((t) => t.classList.add('hidden'));
    const tabEl = document.getElementById(btn.dataset.tab);
    if (tabEl) tabEl.classList.remove('hidden');
    if (btn.dataset.tab === 'deliverability') loadDeliverability();
    if (btn.dataset.tab === 'forms') generateEmbedCode();
  });
});

// ---- Load Application State ----
async function loadAll() {
  try {
    listsCache = await api('/api/lists');
    allTagsCache = await api('/api/tags');

    // Populate List Selectors
    const listSelectors = ['c-list', 'modal-sub-list', 'csv-list-id', 'sub-filter-list', 'embed-list-id'];
    listSelectors.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const isFilter = id === 'sub-filter-list';
        el.innerHTML = (isFilter ? '<option value="">All Lists</option>' : '') +
          listsCache.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
      }
    });

    // Populate Tag Selectors
    const tagFilter = document.getElementById('sub-filter-tag');
    if (tagFilter) {
      tagFilter.innerHTML = '<option value="">All Tags</option>' +
        allTagsCache.map(t => `<option value="${t}">Tag: ${t}</option>`).join('');
    }

    const campTagFilter = document.getElementById('c-tag-filter');
    if (campTagFilter) {
      campTagFilter.innerHTML = '<option value="">All Subscribers on List</option>' +
        allTagsCache.map(t => `<option value="${t}">Target Tag: ${t}</option>`).join('');
    }

    await loadSubscribers();
    await loadCampaigns();
    applyTemplatePreset();
    generateEmbedCode();
  } catch (e) {
    console.error('Initialization error:', e);
  }
}

// ---- Subscribers Tab ----
let subSearchTimer;
function debounceSubscribersSearch() {
  clearTimeout(subSearchTimer);
  subSearchTimer = setTimeout(loadSubscribers, 300);
}

async function loadSubscribers() {
  try {
    const listId = document.getElementById('sub-filter-list')?.value || '';
    const tag = document.getElementById('sub-filter-tag')?.value || '';
    const search = document.getElementById('sub-search')?.value.trim() || '';

    let url = `/api/subscribers?`;
    if (listId) url += `list_id=${listId}&`;
    if (tag) url += `tag=${encodeURIComponent(tag)}&`;
    if (search) url += `search=${encodeURIComponent(search)}`;

    const subs = await api(url);
    document.getElementById('sub-count').textContent = `${subs.length} total subscribers`;

    const tbody = document.getElementById('sub-body');
    if (subs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--text-dim);">No subscribers match your search.</td></tr>`;
      return;
    }

    tbody.innerHTML = subs.map(s => {
      const tagsHtml = (s.tags || '').split(',').filter(Boolean)
        .map(t => `<span class="tag-badge">#${t.trim()}</span>`).join('');
      return `
        <tr>
          <td><span style="font-weight:600;">${s.email}</span></td>
          <td>${s.first_name || '<span style="color:var(--text-dim);">—</span>'}</td>
          <td>${s.list_name}</td>
          <td>${tagsHtml || '<span style="color:var(--text-dim);">—</span>'}</td>
          <td><span class="pill ${s.status}">${s.status}</span></td>
          <td style="text-align:right;">
            ${s.status === 'pending' ? `<button class="btn btn-sm" style="margin-right:6px;" onclick="activateSub(${s.id})">Activate</button>` : ''}
            <button class="btn btn-sm btn-secondary" style="margin-right:6px;" onclick="editTagsPrompt(${s.id}, '${s.tags || ''}')">🏷️ Tags</button>
            <button class="btn btn-sm btn-danger" onclick="deleteSub(${s.id})">Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading subscribers:', e);
  }
}

async function activateSub(id) {
  try {
    await api(`/api/subscribers/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    loadSubscribers();
  } catch (e) { alert(e.message); }
}

async function deleteSub(id) {
  if (!confirm('Are you sure you want to permanently delete this contact?')) return;
  try {
    await api(`/api/subscribers/${id}`, { method: 'DELETE' });
    loadSubscribers();
  } catch (e) { alert(e.message); }
}

async function editTagsPrompt(id, currentTags) {
  const newTags = prompt('Enter comma-separated tags:', currentTags);
  if (newTags === null) return;
  try {
    await api(`/api/subscribers/${id}/tags`, { method: 'PATCH', body: JSON.stringify({ tags: newTags }) });
    loadAll();
  } catch (e) { alert(e.message); }
}

// Add Subscriber Modal
function openAddSubModal() {
  document.getElementById('add-sub-modal').classList.remove('hidden');
}
function closeAddSubModal() {
  document.getElementById('add-sub-modal').classList.add('hidden');
}
async function saveSubscriberModal() {
  const email = document.getElementById('modal-sub-email').value.trim();
  const first_name = document.getElementById('modal-sub-name').value.trim();
  const list_id = document.getElementById('modal-sub-list').value;
  const tags = document.getElementById('modal-sub-tags').value.trim();
  const status = document.getElementById('modal-sub-status').value;

  if (!email) return alert('Email address is required');
  try {
    await api('/api/subscribers', {
      method: 'POST',
      body: JSON.stringify({ email, first_name, list_id, tags, status })
    });
    closeAddSubModal();
    document.getElementById('modal-sub-email').value = '';
    document.getElementById('modal-sub-name').value = '';
    document.getElementById('modal-sub-tags').value = '';
    loadAll();
  } catch (e) { alert(e.message); }
}

// ---- CSV Bulk Import ----
function openCsvModal() {
  document.getElementById('csv-modal').classList.remove('hidden');
  parsedCsvRecords = [];
  document.getElementById('csv-preview-info').textContent = '';
  document.getElementById('csv-import-btn').disabled = true;
}
function closeCsvModal() {
  document.getElementById('csv-modal').classList.add('hidden');
}

function handleCsvFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const text = e.target.result;
    parsedCsvRecords = parseCsvString(text);
    const count = parsedCsvRecords.length;
    document.getElementById('csv-preview-info').textContent =
      `✓ Detected ${count} valid contacts ready for import.`;
    document.getElementById('csv-import-btn').disabled = count === 0;
  };
  reader.readAsText(file);
}

function parseCsvString(csvText) {
  const lines = csvText.split(/\r\n|\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
  const emailIdx = headers.findIndex(h => h.includes('email'));
  const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('first'));
  const tagsIdx = headers.findIndex(h => h.includes('tag'));

  if (emailIdx === -1) {
    alert('Could not find an "email" column in your CSV header.');
    return [];
  }

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
    const email = row[emailIdx];
    if (email && email.includes('@')) {
      records.push({
        email,
        first_name: nameIdx !== -1 ? row[nameIdx] : null,
        tags: tagsIdx !== -1 ? row[tagsIdx] : null
      });
    }
  }
  return records;
}

async function executeCsvImport() {
  if (parsedCsvRecords.length === 0) return;
  const list_id = document.getElementById('csv-list-id').value;
  const append_tags = document.getElementById('csv-append-tags').value.trim();
  const default_status = document.getElementById('csv-status').value;
  const btn = document.getElementById('csv-import-btn');

  btn.disabled = true;
  btn.textContent = 'Importing...';

  try {
    const result = await api('/api/subscribers/import-csv', {
      method: 'POST',
      body: JSON.stringify({ records: parsedCsvRecords, list_id, append_tags, default_status })
    });
    alert(`Success! Imported ${result.imported} contacts (${result.skipped} skipped).`);
    closeCsvModal();
    loadAll();
  } catch (e) {
    alert('Import failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start Import';
  }
}

// ---- Compose & Live Preview ----
const PRESET_TEMPLATES = {
  newsletter: {
    headline: 'Exciting News & Product Updates! 🚀',
    body: '<p>Hey {{first_name}},</p><p>We are delighted to share what we have been building this month. From improved speed to new workflows, our platform is faster than ever.</p><p>Check out the full walkthrough below and let us know what you think!</p>',
    ctaText: 'Explore Features',
    ctaUrl: 'https://example.com'
  },
  deal: {
    headline: 'Exclusive 30% Off Launch Special 🔥',
    body: '<p>Hi {{first_name}},</p><p>As one of our valued subscribers, you are receiving exclusive VIP access to our seasonal upgrade offer. Don\'t miss out before it expires this weekend.</p>',
    ctaText: 'Claim Your 30% Discount',
    ctaUrl: 'https://example.com/deal'
  },
  minimal: {
    headline: 'A quick personal note',
    body: '<p>Hi {{first_name}},</p><p>Wanted to personally reach out and see how everything is going. Feel free to reply directly to this email if you have any questions or feedback.</p>',
    ctaText: '',
    ctaUrl: ''
  },
  custom: {
    headline: '',
    body: '<div style="padding:20px; font-family:sans-serif;">\n  <h2>Custom Branded Layout</h2>\n  <p>Hello {{first_name}}, this is fully custom HTML.</p>\n</div>',
    ctaText: '',
    ctaUrl: ''
  }
};

function applyTemplatePreset() {
  const type = document.getElementById('c-template').value;
  const preset = PRESET_TEMPLATES[type] || PRESET_TEMPLATES.newsletter;

  document.getElementById('c-headline').value = preset.headline;
  document.getElementById('c-body').value = preset.body;
  document.getElementById('c-cta-text').value = preset.ctaText;
  document.getElementById('c-cta-url').value = preset.ctaUrl;

  const ctaFields = document.getElementById('cta-fields');
  ctaFields.style.display = (type === 'minimal' || type === 'custom') ? 'none' : 'grid';

  updateLivePreview();
}

function toggleAbSubject() {
  const isAb = document.getElementById('c-ab-toggle').checked;
  document.getElementById('ab-subject-container').classList.toggle('hidden', !isAb);
}

function toggleScheduleInput() {
  const isScheduled = document.getElementById('c-schedule-toggle').checked;
  document.getElementById('schedule-container').classList.toggle('hidden', !isScheduled);
}

function setPreviewDevice(device) {
  currentPreviewDevice = device;
  document.getElementById('btn-desktop').classList.toggle('active', device === 'desktop');
  document.getElementById('btn-mobile').classList.toggle('active', device === 'mobile');
  document.getElementById('email-preview-frame').classList.toggle('mobile', device === 'mobile');
}

function updateLivePreview() {
  const templateType = document.getElementById('c-template').value;
  const headline = document.getElementById('c-headline').value;
  const body = document.getElementById('c-body').value;
  const ctaText = document.getElementById('c-cta-text').value;
  const ctaUrl = document.getElementById('c-cta-url').value;

  let innerHtml = '';
  if (templateType === 'newsletter') {
    innerHtml = `
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 24px; text-align: center;">
        <span style="font-size:12px; font-weight:700; color:#10b981; letter-spacing:1px; text-transform:uppercase;">Inkwell Announcement</span>
        <h1 style="color:#ffffff; font-size:22px; margin:8px 0 0 0;">${headline || 'Your Headline Here'}</h1>
      </div>
      <div style="padding: 28px; color: #334155; font-size: 15px; line-height: 1.65;">
        ${body || '<p>Email body preview...</p>'}
        ${ctaText ? `<div style="text-align:center; margin:28px 0 10px 0;"><a href="${ctaUrl || '#'}" style="display:inline-block; padding:12px 24px; background:#0f766e; color:#fff; text-decoration:none; font-weight:600; border-radius:6px;">${ctaText}</a></div>` : ''}
      </div>
    `;
  } else if (templateType === 'deal') {
    innerHtml = `
      <div style="padding: 28px 24px 0 24px; text-align: center;">
        <span style="display:inline-block; padding:4px 12px; background:#fef3c7; color:#b45309; font-size:12px; font-weight:700; border-radius:20px;">SPECIAL EXCLUSIVE</span>
        <h1 style="color:#0f172a; font-size:24px; margin:14px 0 0 0;">${headline || 'Exclusive Deal'}</h1>
      </div>
      <div style="padding: 24px 28px; color: #334155; font-size: 15px; line-height: 1.65;">
        ${body || '<p>Offer details...</p>'}
        ${ctaText ? `<div style="text-align:center; margin:24px 0 8px 0;"><a href="${ctaUrl || '#'}" style="display:inline-block; padding:13px 28px; background:#e11d48; color:#fff; text-decoration:none; font-weight:700; border-radius:6px;">${ctaText}</a></div>` : ''}
      </div>
    `;
  } else if (templateType === 'minimal') {
    innerHtml = `
      <div style="padding: 32px 28px; color: #1e293b; font-size: 15px; line-height: 1.7;">
        ${body || '<p>Personal message preview...</p>'}
        <p style="margin-top:24px; font-weight:600;">— The Inkwell Team</p>
      </div>
    `;
  } else {
    innerHtml = body || '<div style="padding:20px;">Custom HTML</div>';
  }

  const fullEmailDoc = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#f1f5f9;font-family:sans-serif;} .card{max-width:580px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.06);} .footer{background:#f8fafc;padding:16px;text-align:center;font-size:11.5px;color:#64748b;border-top:1px solid #e2e8f0;}</style></head>
    <body>
      <div class="card">
        ${innerHtml}
        <div class="footer">
          Inkwell Marketing Demo &bull; 100 Innovation Way, SF, CA<br>
          <a href="#" style="color:#64748b;">Unsubscribe</a> &bull; <a href="#" style="color:#64748b;">View Data</a>
        </div>
      </div>
    </body>
    </html>
  `;

  const frame = document.getElementById('email-preview-frame');
  frame.srcdoc = fullEmailDoc;

  runSpamCheck();
}

let spamTimer;
function runSpamCheck() {
  clearTimeout(spamTimer);
  spamTimer = setTimeout(async () => {
    const subject = document.getElementById('c-subject').value;
    const body_html = document.getElementById('c-body').value;
    if (!subject && !body_html) {
      document.getElementById('spam-warnings').innerHTML = '';
      return;
    }
    try {
      const res = await api('/api/campaigns/check', {
        method: 'POST',
        body: JSON.stringify({ subject, body_html })
      });
      const box = document.getElementById('spam-warnings');
      if (res.warnings.length === 0) {
        box.innerHTML = `<div style="font-size:12.5px; color:var(--status-good); padding:8px 12px; background:var(--status-good-bg); border-radius:6px;">✓ Deliverability Score: Clean (0 spam triggers detected)</div>`;
      } else {
        box.innerHTML = `
          <div style="font-size:12px; color:var(--status-warn); padding:8px 12px; background:var(--status-warn-bg); border-radius:6px;">
            ⚠️ Content Alert (Risk: ${res.risk})
            ${res.warnings.map(w => `<div style="margin-top:2px;">• ${w.message}</div>`).join('')}
          </div>
        `;
      }
    } catch (e) {}
  }, 400);
}

async function createCampaign() {
  const subject = document.getElementById('c-subject').value.trim();
  const is_ab_test = document.getElementById('c-ab-toggle').checked ? 1 : 0;
  const subject_b = document.getElementById('c-subject-b').value.trim();
  const list_id = document.getElementById('c-list').value;
  const tag_filter = document.getElementById('c-tag-filter').value;
  const template_type = document.getElementById('c-template').value;
  const body_html = document.getElementById('c-body').value;
  const scheduled_for = document.getElementById('c-schedule-toggle').checked ? document.getElementById('c-scheduled-time').value : null;
  const statusEl = document.getElementById('status');

  if (!subject) return alert('Subject line is required');

  try {
    statusEl.textContent = 'Saving campaign...';
    const c = await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        subject,
        subject_b,
        is_ab_test,
        list_id,
        tag_filter,
        template_type,
        body_html,
        scheduled_for
      })
    });
    statusEl.innerHTML = `✓ Campaign saved successfully (${c.status})! <button class="btn btn-sm" style="margin-left:8px;" onclick="document.querySelector('[data-tab=campaigns]').click()">View in Campaigns</button>`;
    loadCampaigns();
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

// ---- Campaigns Tab ----
async function loadCampaigns() {
  try {
    const camps = await api('/api/campaigns');
    const tbody = document.getElementById('camp-body');
    if (camps.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-dim);">No campaigns created yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = camps.map(c => {
      let abStat = '<span style="color:var(--text-dim);">—</span>';
      if (c.is_ab_test) {
        const rateA = c.stats.sent_a ? ((c.stats.opened_a / c.stats.sent_a) * 100).toFixed(1) : 0;
        const rateB = c.stats.sent_b ? ((c.stats.opened_b / c.stats.sent_b) * 100).toFixed(1) : 0;
        abStat = `<span style="font-size:12px;"><b>A:</b> ${rateA}% | <b>B:</b> ${rateB}%</span>`;
      }

      return `
        <tr>
          <td>
            <div style="font-weight:700;">${c.subject}</div>
            ${c.is_ab_test ? `<div style="font-size:12px; color:var(--accent-purple);">B: ${c.subject_b}</div>` : ''}
          </td>
          <td><span class="pill ${c.status}">${c.status}</span></td>
          <td>${c.stats.sent || 0}</td>
          <td>${c.stats.opened || 0}</td>
          <td>${c.stats.clicked || 0}</td>
          <td>${abStat}</td>
          <td style="text-align:right;">
            ${c.status === 'draft' ? `<button class="btn btn-sm" onclick="sendCampaign(${c.id})">Send Now</button>` : `<button class="btn btn-sm btn-secondary" onclick="sendCampaign(${c.id}, true)">Resend</button>`}
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading campaigns:', e);
  }
}

async function sendCampaign(id, resend = false) {
  const msg = resend ? 'Resend this campaign to active list recipients?' : 'Dispatch this campaign now to active recipients?';
  if (!confirm(msg)) return;
  try {
    const r = await api(`/api/campaigns/${id}/send`, { method: 'POST', body: JSON.stringify({ resend }) });
    alert(`Queued sending to ${r.queued} contacts.`);
    setTimeout(loadCampaigns, 1500);
  } catch (e) { alert('Error: ' + e.message); }
}

// ---- Deliverability Tab ----
function pct(n) { return (n * 100).toFixed(2) + '%'; }
const statusColor = { good: 'var(--status-good)', warn: 'var(--status-warn)', bad: 'var(--status-bad)' };

async function loadDeliverability() {
  try {
    const r = await api('/api/reports/deliverability');
    document.getElementById('deliv-report').innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:24px;">
        <div class="panel"><div class="panel-body">
          <div class="muted" style="font-size:12px; font-weight:700; text-transform:uppercase;">Bounce Rate</div>
          <div style="font-size:26px; font-weight:800; color:${statusColor[r.rates.bounce_rate_status]}">${pct(r.rates.bounce_rate)}</div>
          <div class="muted" style="font-size:11.5px; margin-top:2px;">Threshold: keep &lt; 2.0%</div>
        </div></div>
        <div class="panel"><div class="panel-body">
          <div class="muted" style="font-size:12px; font-weight:700; text-transform:uppercase;">Complaint Rate</div>
          <div style="font-size:26px; font-weight:800; color:${statusColor[r.rates.complaint_rate_status]}">${pct(r.rates.complaint_rate)}</div>
          <div class="muted" style="font-size:11.5px; margin-top:2px;">Threshold: keep &lt; 0.1%</div>
        </div></div>
        <div class="panel"><div class="panel-body">
          <div class="muted" style="font-size:12px; font-weight:700; text-transform:uppercase;">Open Rate</div>
          <div style="font-size:26px; font-weight:800;">${pct(r.rates.open_rate)}</div>
          <div class="muted" style="font-size:11.5px; margin-top:2px;">Industry avg: 18–25%</div>
        </div></div>
        <div class="panel"><div class="panel-body">
          <div class="muted" style="font-size:12px; font-weight:700; text-transform:uppercase;">Click Rate</div>
          <div style="font-size:26px; font-weight:800;">${pct(r.rates.click_rate)}</div>
          <div class="muted" style="font-size:11.5px; margin-top:2px;">Industry avg: 2–4%</div>
        </div></div>
      </div>
    `;

    const cold = await api('/api/reports/cold-subscribers');
    const coldBody = document.getElementById('cold-body');
    if (cold.length === 0) {
      coldBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--text-dim);">✓ Excellent list hygiene. Zero cold subscribers found.</td></tr>`;
      return;
    }
    coldBody.innerHTML = cold.map(s => `
      <tr>
        <td><input type="checkbox" class="cold-check" value="${s.id}"></td>
        <td><b>${s.email}</b></td>
        <td>${s.last_engaged_at || 'Never'}</td>
        <td>${s.confirmed_at || '—'}</td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading deliverability:', e);
  }
}

function toggleAllCold(el) {
  document.querySelectorAll('.cold-check').forEach(c => c.checked = el.checked);
}

async function suppressSelectedCold() {
  const ids = Array.from(document.querySelectorAll('.cold-check:checked')).map(c => Number(c.value));
  if (ids.length === 0) return alert('Select at least one cold contact to suppress.');
  if (!confirm(`Suppress ${ids.length} contacts? They will be marked as unsubscribed.`)) return;
  try {
    await api('/api/reports/suppress', { method: 'POST', body: JSON.stringify({ ids }) });
    alert('Contacts suppressed.');
    loadDeliverability();
  } catch (e) { alert(e.message); }
}

// ---- Embed Form Generator ----
function generateEmbedCode() {
  const listId = document.getElementById('embed-list-id')?.value || 1;
  const title = document.getElementById('embed-title')?.value || 'Subscribe to our newsletter';
  const color = document.getElementById('embed-color')?.value || '#0d9488';
  const host = window.location.origin;

  const codeSnippet = `<script\n  src="${host}/embed.js"\n  data-list="${listId}"\n  data-title="${title}"\n  data-color="${color}">\n</script>`;

  const displayEl = document.getElementById('embed-code-display');
  if (displayEl) displayEl.textContent = codeSnippet;

  // Render Live Preview
  const previewEl = document.getElementById('embed-live-preview');
  if (previewEl) {
    previewEl.innerHTML = `
      <div style="font-family:sans-serif; width:340px; padding:22px; border:1px solid #1f293d; border-radius:12px; background:#111827; box-shadow:0 4px 16px rgba(0,0,0,0.4);">
        <h3 style="margin:0 0 6px 0; color:#fff; font-size:17px; font-weight:700;">${title}</h3>
        <p style="margin:0 0 14px 0; color:#94a3b8; font-size:13px;">Get updates delivered straight to your inbox.</p>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <input type="text" placeholder="First Name (optional)" style="margin:0; padding:9px 12px; font-size:13px;" readonly>
          <input type="email" placeholder="Your Email Address" style="margin:0; padding:9px 12px; font-size:13px;" readonly>
          <button style="padding:10px; background:${color}; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">Subscribe</button>
        </div>
      </div>
    `;
  }
}

function copyEmbedCode() {
  const code = document.getElementById('embed-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => {
    alert('Embed snippet copied to clipboard! Paste it into your website HTML.');
  });
}

// Initial Boot
loadAll();
