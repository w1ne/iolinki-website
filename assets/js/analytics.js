/* Consent-controlled GA4. Keep the payload contract in docs/ANALYTICS.md. */
(() => {
  const id = 'G-J1J05JDQEV';
  const consentKey = 'iolinki-analytics-consent';
  const internalKey = 'iolinki-analytics-internal';
  const lifetime = 180 * 86400000;
  const params = new URLSearchParams(location.search);
  let internal = params.get('analytics_internal') === '1' || params.get('lw_internal') === '1';
  try {
    if (params.has('analytics_internal') || params.has('lw_internal'))
      localStorage.setItem(internalKey, internal ? '1' : '0');
    internal ||= localStorage.getItem(internalKey) === '1';
  } catch {}
  const blocked = internal || !['iolinki.com', 'www.iolinki.com'].includes(location.hostname)
    || navigator.doNotTrack === '1' || window.doNotTrack === '1'
    || navigator.globalPrivacyControl === true || window.top !== window.self;
  let choice;
  try {
    const saved = JSON.parse(localStorage.getItem(consentKey));
    if (saved?.expires > Date.now() && saved.expires <= Date.now() + lifetime
      && ['granted', 'denied'].includes(saved.choice)) choice = saved.choice;
  } catch {}
  let started = false;
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  let pagePath = '/';
  try {
    const url = new URL(canonical);
    if (url.origin === 'https://iolinki.com' && /^\/[a-zA-Z0-9/_.-]*$/.test(url.pathname)) pagePath = url.pathname;
  } catch {}
  const metadata = {page_location:'https://iolinki.com' + pagePath, page_referrer:'', page_title:'iolinki'};
  const contract = {
    page_view: {},
    file_download: {artifact:['iodd-example','mcp-package','agent-plugin','source-tools','firmware-release','other-public']},
    iodd_create: {template:['blank','counter','switching-sensor']},
    iodd_import: {format:['xml','zip','json']},
    iodd_export: {format:['xml','zip','header','json','firmware']},
    mcp_setup_copy: {client:['chatgpt','codex','claude','cursor','vscode'],action:['client-config','example-prompt','local-command','local-config']},
    begin_checkout: {tier:['single','team']},
    contact_click: {},
  };
  function track(name, values = {}) {
    if (!started || choice !== 'granted' || blocked || !Object.hasOwn(contract, name)) return;
    const safe = {...metadata};
    for (const [key, allowed] of Object.entries(contract[name]))
      if (allowed.includes(values[key])) safe[key] = values[key];
    if (params.get('analytics_debug') === '1') safe.debug_mode = true;
    window.gtag('event', name, safe);
  }
  window.iolinkiAnalytics = Object.freeze({track});
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/assets/css/analytics.css'; document.head.append(css);
  const notice = document.createElement('aside');
  notice.id = 'analytics-choice'; notice.setAttribute('aria-label','Analytics preferences');
  notice.innerHTML = '<p>Allow Google Analytics cookies to help us understand visits, downloads and tool usage? <a href="/legal.html#website-analytics">Privacy details</a></p><div><button type="button" data-choice="denied">Decline analytics</button><button type="button" data-choice="granted">Accept analytics</button></div>';
  const settings = document.createElement('button');
  settings.id='analytics-settings'; settings.type='button'; settings.textContent='Analytics settings';
  notice.hidden = blocked || !!choice;
  settings.hidden = blocked;
  document.body.append(notice, settings);
  function start() {
    if (started || blocked || choice !== 'granted') return;
    started = true;
    window['ga-disable-' + id] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() { window.dataLayer.push(arguments); };
    window.gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    window.gtag('consent','update',{analytics_storage:'granted'});
    window.gtag('js',new Date());
    window.gtag('config',id,{...metadata,send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,cookie_expires:180*86400,cookie_update:false});
    track('page_view');
    const script = document.createElement('script'); script.async=true;
    script.referrerPolicy='no-referrer'; script.src='https://www.googletagmanager.com/gtag/js?id='+id;
    document.head.append(script);
  }
  function removeCookies() {
    for (const cookie of document.cookie.split(';')) {
      const name=cookie.split('=')[0].trim();
      if (!/^_ga(?:_|$)/.test(name)) continue;
      for (const domain of ['',location.hostname,'.'+location.hostname,'.iolinki.com'])
        document.cookie=name+'=; Max-Age=0; path=/'+(domain?'; domain='+domain:'');
    }
  }
  settings.addEventListener('click',()=>{notice.hidden=false;notice.querySelector('button').focus();});
  for(const button of notice.querySelectorAll('button')) button.addEventListener('click',()=>{
    choice=button.dataset.choice;
    try {localStorage.setItem(consentKey,JSON.stringify({choice,expires:Date.now()+lifetime}));}catch{}
    notice.hidden=true;
    settings.focus();
    if(choice==='granted') start();
    else {
      window['ga-disable-'+id]=true;
      removeCookies();
      if(started) {started=false;window.dataLayer.length=0;}
    }
  });
  if(blocked) {window['ga-disable-'+id]=true;removeCookies();}
  start();
  document.addEventListener('click',event=>{
    const link=event.target instanceof Element?event.target.closest('a[href]'):null;
    if(!link) return;
    const url=new URL(link.href,location.href);
    if(url.protocol==='mailto:') {track('contact_click');return;}
    let artifact;
    if(url.origin===location.origin && url.pathname.startsWith('/downloads/')) {
      const name=url.pathname.split('/').pop();
      artifact=name.startsWith('iodd-mcp-')?'mcp-package':name==='iolinki-agent-plugin.zip'?'agent-plugin':name==='iodd-tools.zip'?'source-tools':/^iodd-(counter|switching-sensor)\.zip$/.test(name)?'iodd-example':'other-public';
    } else if(url.hostname==='github.com' && /^\/w1ne\/iolinki(?:-master)?\/releases\/download\//.test(url.pathname)) artifact='firmware-release';
    if(artifact) track('file_download',{artifact});
  });
})();
