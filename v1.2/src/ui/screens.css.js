// Voidworks — shared stylesheet for the front screens, injected once into the head at first use.

import { SCREENS } from '../config.js';

const C = SCREENS.colors;
const EASE = 'cubic-bezier(.22,.61,.36,1)';

const CSS = `
.vw-screen{position:fixed;inset:0;z-index:8;color:${C.text};
font:500 14px/1.45 ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;
font-feature-settings:"tnum" 1,"lnum" 1;-webkit-font-smoothing:antialiased;
opacity:0;transition:opacity ${SCREENS.fadeOut}s ${EASE}}
.vw-screen.is-on{opacity:1}
.vw-screen.is-gone{pointer-events:none}
.vw-screen input,.vw-screen button,.vw-screen select{font:inherit;color:inherit}
.vw-screen ::selection{background:rgba(23,201,100,.22)}

.vw-veil{position:absolute;inset:0;background:${SCREENS.veil};
backdrop-filter:blur(${SCREENS.blurPx}px) saturate(1.02);-webkit-backdrop-filter:blur(${SCREENS.blurPx}px) saturate(1.02)}
.vw-vignette{position:absolute;inset:0;pointer-events:none;
background:radial-gradient(116% 86% at 60% 44%,transparent 40%,rgba(26,29,34,.17) 100%)}
.vw-grain{position:absolute;inset:0;pointer-events:none;opacity:.55;
background:repeating-linear-gradient(0deg,rgba(26,29,34,.018) 0 1px,transparent 1px 3px)}

.vw-label{font-size:9.5px;letter-spacing:.24em;text-transform:uppercase;color:${C.dim}}
.vw-rule{height:1px;background:linear-gradient(90deg,${C.accent},rgba(23,201,100,0));opacity:.6}

.vw-menu{position:absolute;inset:0;display:flex;align-items:center;overflow-y:auto;
padding:clamp(28px,6vh,64px) clamp(28px,7vw,120px);gap:clamp(28px,4vw,64px)}
.vw-menu-col{width:min(500px,46vw);flex:0 0 auto;display:flex;flex-direction:column;gap:34px;
margin:auto 0}
.vw-brand{display:flex;flex-direction:column;gap:12px}
.vw-eyebrow{font-size:10px;letter-spacing:.38em;text-transform:uppercase;color:${C.accentDeep};opacity:.9}
.vw-title{font-size:clamp(34px,4.2vw,58px);font-weight:200;letter-spacing:.16em;text-transform:uppercase;
line-height:1.02;text-indent:.16em;white-space:nowrap;color:${C.bright};
background:linear-gradient(166deg,#080a0e 4%,#525b69 94%);-webkit-background-clip:text;background-clip:text;
-webkit-text-fill-color:transparent}
.vw-title-rule{height:1px;width:0;background:linear-gradient(90deg,${C.accent},rgba(23,201,100,0));
transition:width 1.5s ${EASE} .28s}
.vw-screen.is-on .vw-title-rule{width:100%}
.vw-tagline{font-size:13px;line-height:1.6;color:${C.dim};max-width:46ch}

.vw-nav{display:flex;flex-direction:column;align-items:flex-start;gap:2px;margin-left:-14px}
.vw-nav.is-off{display:none}
.vw-nav-item{position:relative;display:flex;align-items:baseline;gap:12px;
padding:11px 14px;background:none;border:0;cursor:pointer;text-align:left;
font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:${C.text};
opacity:0;transform:translateY(9px);
transition:opacity .5s ${EASE},transform .5s ${EASE},color .22s ease}
.vw-screen.is-on .vw-nav-item{opacity:.8;transform:none}
.vw-nav-item::before{content:"";position:absolute;left:0;top:50%;width:2px;height:0;
transform:translateY(-50%);background:${C.accent};border-radius:2px;
transition:height .26s ${EASE},opacity .26s ease;opacity:0}
.vw-nav-item:hover,.vw-nav-item:focus-visible,.vw-nav-item.is-active{opacity:1;color:${C.bright};outline:none}
.vw-nav-item:hover::before,.vw-nav-item:focus-visible::before,.vw-nav-item.is-active::before{height:17px;opacity:1}
.vw-nav-text{display:inline-block;transition:transform .26s ${EASE}}
.vw-nav-item:hover .vw-nav-text,.vw-nav-item:focus-visible .vw-nav-text,
.vw-nav-item.is-active .vw-nav-text{transform:translateX(7px)}
.vw-nav-note{font-size:10.5px;letter-spacing:.06em;text-transform:none;color:${C.dim};
opacity:0;transform:translateX(2px);transition:opacity .3s ease,transform .3s ease}
.vw-nav-item:hover .vw-nav-note,.vw-nav-item:focus-visible .vw-nav-note,
.vw-nav-item.is-active .vw-nav-note{opacity:1;transform:translateX(7px)}

.vw-foot{position:absolute;left:clamp(28px,7vw,120px);bottom:34px;display:flex;gap:22px;align-items:center;
font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${C.dim};
opacity:0;transition:opacity .8s ease .7s}
.vw-screen.is-on .vw-foot{opacity:1}

.vw-panels{display:grid;align-items:center;justify-items:start}
.vw-panel{grid-area:1/1;position:relative;width:min(430px,44vw);padding:26px 28px 28px;border-radius:16px;
max-height:78vh;overflow-y:auto;scrollbar-width:thin;overscroll-behavior:contain;
background:${C.panel};border:1px solid ${C.panelEdge};
box-shadow:0 32px 72px rgba(26,29,34,.19),0 3px 10px rgba(26,29,34,.09),inset 0 1px 0 rgba(255,255,255,.85);
backdrop-filter:blur(${SCREENS.panelBlurPx}px) saturate(1.1);
-webkit-backdrop-filter:blur(${SCREENS.panelBlurPx}px) saturate(1.1);
display:flex;flex-direction:column;gap:20px;
opacity:0;transform:translateX(16px) scale(.985);pointer-events:none;
transition:opacity .34s ${EASE},transform .34s ${EASE}}
.vw-panel.is-on{opacity:1;transform:none;pointer-events:auto}
.vw-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.vw-panel-title{font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:${C.bright}}
.vw-panel-body{display:flex;flex-direction:column;gap:18px}
.vw-hr{height:1px;background:${C.faint}}

.vw-field{display:flex;flex-direction:column;gap:9px}
.vw-field-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.vw-field-value{font-size:11px;letter-spacing:.08em;color:${C.text};opacity:.85}
.vw-note{font-size:10.5px;line-height:1.5;color:${C.dim}}
.vw-note.is-bad{color:${C.fail}}

.vw-stat{display:flex;flex-direction:column;gap:10px;padding:15px 16px;border-radius:12px;
background:rgba(255,255,255,.5);border:1px solid ${C.faint}}
.vw-stat-row{display:flex;align-items:baseline;justify-content:space-between;gap:14px}
.vw-stat-value{font-size:14px;letter-spacing:.05em;color:${C.bright}}
.vw-stat-value.is-money{color:${C.accentDeep};font-weight:600}

.vw-chips{display:flex;flex-wrap:wrap;gap:8px}
.vw-chip{padding:7px 13px;border-radius:9px;cursor:pointer;
background:rgba(255,255,255,.55);border:1px solid ${C.faint};
font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:${C.dim};
transition:color .22s ease,border-color .22s ease,background .22s ease,transform .22s ease}
.vw-chip:hover{color:${C.text};border-color:rgba(26,29,34,.2);transform:translateY(-1px)}
.vw-chip.is-on{color:${C.onAccent};background:${C.accent};border-color:${C.accent};font-weight:600}
.vw-chip:focus-visible{outline:none;border-color:${C.accent};box-shadow:0 0 0 3px rgba(23,201,100,.22)}

.vw-input{width:100%;padding:11px 13px;border-radius:10px;background:rgba(255,255,255,.75);
border:1px solid rgba(26,29,34,.14);letter-spacing:.06em;color:${C.bright};
transition:border-color .22s ease,background .22s ease,box-shadow .22s ease}
.vw-input:focus{outline:none;border-color:${C.accent};background:#fff;box-shadow:0 0 0 3px rgba(23,201,100,.16)}
.vw-input::placeholder{color:rgba(26,29,34,.26)}
.vw-input.vw-code{font:600 20px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.34em;
text-transform:uppercase;text-align:center;padding:14px 10px 14px 20px}
.vw-input.is-bad{border-color:${C.fail};box-shadow:0 0 0 3px rgba(224,82,74,.14)}

.vw-select{width:100%;padding:11px 13px;border-radius:10px;background:rgba(255,255,255,.75);
border:1px solid rgba(26,29,34,.14);color:${C.bright};cursor:pointer;
-webkit-appearance:none;appearance:none;
background-image:linear-gradient(45deg,transparent 50%,${C.dim} 50%),linear-gradient(135deg,${C.dim} 50%,transparent 50%);
background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%;background-size:5px 5px,5px 5px;
background-repeat:no-repeat;transition:border-color .22s ease,box-shadow .22s ease}
.vw-select:focus{outline:none;border-color:${C.accent};box-shadow:0 0 0 3px rgba(23,201,100,.16)}

.vw-range{-webkit-appearance:none;appearance:none;width:100%;height:18px;background:none;cursor:pointer}
.vw-range::-webkit-slider-runnable-track{height:3px;border-radius:3px;
background:linear-gradient(90deg,${C.accent} var(--p,50%),rgba(26,29,34,.13) var(--p,50%))}
.vw-range::-moz-range-track{height:3px;border-radius:3px;background:rgba(26,29,34,.13)}
.vw-range::-moz-range-progress{height:3px;border-radius:3px;background:${C.accent}}
.vw-range::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;margin-top:-5px;
border-radius:50%;background:${C.bright};box-shadow:0 1px 5px rgba(26,29,34,.28);
transition:transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .18s ease}
.vw-range::-moz-range-thumb{width:13px;height:13px;border:0;border-radius:50%;background:${C.bright}}
.vw-range:hover::-webkit-slider-thumb{transform:scale(1.18)}
.vw-range:focus-visible{outline:none}
.vw-range:focus-visible::-webkit-slider-thumb{transform:scale(1.18);box-shadow:0 0 0 4px rgba(23,201,100,.26)}

.vw-btn{position:relative;padding:12px 22px;border-radius:11px;cursor:pointer;border:1px solid transparent;
font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;
background:linear-gradient(168deg,#3fe089,${C.accent});color:${C.onAccent};
box-shadow:0 10px 26px rgba(14,159,76,.24);
transition:transform .2s ${EASE},box-shadow .24s ease,opacity .24s ease,filter .24s ease}
.vw-btn:hover{transform:translateY(-1px);box-shadow:0 14px 32px rgba(14,159,76,.32);filter:brightness(1.04)}
.vw-btn:active{transform:translateY(0);box-shadow:0 6px 16px rgba(14,159,76,.24)}
.vw-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(23,201,100,.3),0 12px 28px rgba(14,159,76,.26)}
.vw-btn.is-ghost{background:none;color:${C.text};border-color:rgba(26,29,34,.14);box-shadow:none;font-weight:500}
.vw-btn.is-ghost:hover{border-color:rgba(26,29,34,.3);background:rgba(255,255,255,.55);filter:none}
.vw-btn.is-ghost:focus-visible{box-shadow:0 0 0 3px rgba(23,201,100,.24)}
.vw-btn[disabled]{opacity:.34;cursor:default;transform:none;box-shadow:none;filter:none}
.vw-btn-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}

.vw-code-box{display:flex;flex-direction:column;gap:9px}
.vw-code-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.vw-code-value{font:300 24px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.28em;
text-indent:.28em;color:${C.accentDeep}}
.vw-code-value.is-pending{color:${C.dim}}
.vw-copy{padding:8px 13px;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.55);
border:1px solid ${C.faint};font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;
color:${C.dim};transition:color .22s ease,border-color .22s ease,background .22s ease}
.vw-copy:hover{color:${C.text};border-color:rgba(26,29,34,.26)}
.vw-copy.is-done{color:${C.onAccent};background:${C.accent};border-color:${C.accent};font-weight:600}
.vw-copy:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(23,201,100,.24)}

.vw-credits{display:flex;flex-direction:column;gap:14px}
.vw-credit{display:flex;align-items:baseline;justify-content:space-between;gap:16px}
.vw-credit-role{font-size:9.5px;letter-spacing:.24em;text-transform:uppercase;color:${C.dim}}
.vw-credit-name{font-size:13px;letter-spacing:.05em;color:${C.bright};text-align:right}

@media (max-width:900px){
.vw-menu{flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:26px}
.vw-menu-col{width:min(400px,86vw);margin:0;gap:22px}
.vw-panels{width:100%;padding-bottom:24px}
.vw-title{font-size:clamp(30px,8vw,44px)}
.vw-panel{width:min(400px,86vw);max-height:74vh}
.vw-foot{display:none}}
@media (prefers-reduced-motion:reduce){
.vw-screen *,.vw-screen{transition-duration:.01ms!important;animation:none!important}}
`;

let injected = false;

export function injectScreenStyles() {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'vw-screens';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function el(tag, cls, parent, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}
