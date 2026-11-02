// Replaces emoji with inline SVG icons (Zamorin kit rule: icons are inline SVG, never emoji).
// Runs on text nodes in the signed-in shell; the login screen (#app.auth-screen) is skipped.
// Pure presentation: no data, routes or business logic are touched.
const P = {
  alert: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 7.7 8 9 4.8-1.3 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  xc: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  helpc: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  docs: '<path d="M15 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6Z"/><path d="M15 2v4h4M4 7v13a2 2 0 0 0 2 2h9"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-3.5M4 4v4h4M4 13a8 8 0 0 0 14.5 3.5M20 20v-4h-4"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
  clip: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  bars: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  line: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  down: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 20h16"/>',
  up: '<path d="M12 15V3m0 0L8 7m4-4 4 4M4 20h16"/>',
  scale: '<path d="M12 3v18M5 21h14M4 7h16M4 7l-2 7a3 3 0 0 0 6 0Zm16 0-2 7a3 3 0 0 0 6 0Z"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  box: '<path d="M20 7 12 3 4 7v10l8 4 8-4Z"/><path d="m4 7 8 4 8-4M12 11v10"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.4 6.4A16.6 16.6 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4-.9"/>',
  hour: '<path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM17 11h2a2.5 2.5 0 0 1 0 5h-2M7 3v3M11 3v3M15 3v3"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bank: '<path d="m3 9 9-6 9 6M5 9v9M9 9v9M15 9v9M19 9v9M3 21h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6M16 5a3 3 0 0 1 0 6M18 14.5c2 .7 3.5 2.6 3.5 5.5"/>',
  printer: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>',
  rocket: '<path d="M5 15c-1.5 1.2-2 4-2 6 2 0 4.8-.5 6-2M14 4c3-1.5 6-1.5 6-1.5s0 3-1.5 6l-6.5 6.5-4.5-4.5ZM9 12l-4-1 2-3 4 .5M12 15l1 4 3-2-.5-4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V4h6v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8Z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 10v.01M18 14v.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clipx: '<path d="m21 11-9 9a5 5 0 0 1-7-7l9-9a3.3 3.3 0 0 1 5 5l-9 9a1.7 1.7 0 0 1-2.5-2.5l8-8"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2Z"/><path d="M16 14.5h.01"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  ring: '<circle cx="12" cy="12" r="5"/>',
  utensils: '<path d="M5 3v8a2 2 0 0 0 2 2v8M9 3v8a2 2 0 0 1-2 2M15 21V3c3 1 4 4 4 8h-4"/>',
  flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C8 10 5 12 5 15a7 7 0 0 0 7 7Z"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM8 3v5h7M8 21v-7h8v7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15 18 9ZM10 20a2 2 0 0 0 4 0"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6M5 21h14M12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8c-2 0-4-1-4-3s3-2 4 1c1-3 4-3 4-1s-2 3-4 3Z"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  grad: '<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5ZM4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>',
  steth: '<path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>',
  truck: '<path d="M2 6h11v11H2zM13 10h4l4 4v3h-8"/><circle cx="6.5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15 9.5a6 6 0 1 1-5.5 5.5M9 6v6M7 8.5h3.5a1.2 1.2 0 0 1 0 2.5H8"/>',
  call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5Z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5L5 20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  back: '<path d="M21 5H9l-6 7 6 7h12ZM13 9l4 6M17 9l-4 6"/>',
  puzzle: '<path d="M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v6H4v-4h2a2 2 0 1 0 0-4H4V6h6Z"/>',
  paw: '<circle cx="6" cy="10" r="1.8"/><circle cx="10" cy="6" r="1.8"/><circle cx="14" cy="6" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M12 12c-3 0-5 3-5 5.5 0 1.5 1.3 2 3 1.5 1-.3 1.5-.3 2-.3s1 0 2 .3c1.7.5 3-.1 3-1.5C17 15 15 12 12 12Z"/>',
  store: '<path d="M3 9 5 4h14l2 5M3 9v1a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9M5 13v8h14v-8M10 21v-5h4v5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  signal: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.7 7L4 20l1.2-4.3A8 8 0 1 1 21 12Z"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11L21 7H6"/>',
  flask: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3M7.5 15h9"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>',
  vol: '<path d="M4 9v6h4l5 4V5L8 9ZM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  voloff: '<path d="M4 9v6h4l5 4V5L8 9ZM17 9l5 6M22 9l-5 6"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M12 17 8 8h-3M8 8h7l3.5 9M15 8l-1-3h-2"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  home: '<path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  sunrise: '<path d="M12 3v3M5 8l2 2M19 8l-2 2M2 16h20M6 16a6 6 0 0 1 12 0M8 20h8"/>',
  therm: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/>',
  hand: '<path d="M7 11V6a1.5 1.5 0 0 1 3 0v5M10 11V4.5a1.5 1.5 0 0 1 3 0V11M13 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6 6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L7 14"/>',
  mega: '<path d="m3 11 14-6v14L3 13ZM7 14l1.5 6H11l-1.5-6"/>',
  party: '<path d="m3 21 4-12 8 8ZM14 4l.5 2M19 8l-2 1M17 3l-1 2M20 13h2"/>',
  hash: '<path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0ZM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 14v4M8 21h8M9 18h6"/>',
  stop: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z"/><path d="M12 8v5M12 16h.01"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0ZM12 18v4"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2.4-.6-.6-2.4Z"/>',
  books: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 5.5l3.8-1 3 15-3.8 1Z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  brick: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.5h18M3 14.5h18M9 4v5.5M15 9.5v5M9 14.5V20"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.3 0 2-.8 2-1.8 0-1.2-1-1.5-1-2.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3Z"/><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01"/>',
  access: '<circle cx="12" cy="4.5" r="1.8"/><path d="M5 8.5h14M12 8.5V14l-3 7M12 14l3 7"/>',
  torch: '<path d="M9 2h6l1 6H8ZM8 8l1 14h6l1-14M12 12v3"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="m8.5 3 3.5 6M15.5 3 12 9"/>',
  hosp: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M12 9v6M9 12h6"/>',
  conc: '<path d="M4 18h16M6 18a6 6 0 0 1 12 0M12 8V6M10 6h4"/>',
  leaf: '<path d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15ZM5 19l8-8"/>',
  bridge: '<path d="M2 18h20M4 18v-6M20 18v-6M4 12c4 0 4-5 8-5s4 5 8 5M9 12v6M15 12v6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  diamond: '<path d="m12 3 3 6-3 12L9 9ZM3 9h18"/>',
  arrdown: '<path d="M12 4v16m0 0-6-6m6 6 6-6"/>',
  arrleft: '<path d="M20 12H4m0 0 6-6m-6 6 6 6"/>',
  arrright: '<path d="M4 12h16m0 0-6-6m6 6-6 6"/>',
  arrne: '<path d="M7 17 17 7M8 7h9v9"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  turn: '<path d="M6 4v8a3 3 0 0 0 3 3h9M14 11l4 4-4 4"/>',
  updown: '<path d="M8 4v16M8 4 4 8M8 4l4 4M16 20V4M16 20l-4-4M16 20l4-4"/>',
  upload: '<path d="M12 15V3m0 0L8 7m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  tri: '<path d="m12 5 8 14H4Z"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  sparkle: '<path d="m12 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/>',
  bag: '<path d="M5 8h14l-1 12H6ZM9 8V6a3 3 0 0 1 6 0v2"/>',
  cake: '<path d="M4 20h16v-6H4ZM4 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2M12 8V5M12 3v.01"/>',
  ticket: '<path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 0 0-6V6H3ZM14 6v12"/>',
  ring2: '<circle cx="12" cy="14" r="6"/><path d="m9 8 3-5 3 5"/>',
  run: '<circle cx="14" cy="4" r="2"/><path d="m8 21 3-6-2-3 4-3 3 3h3M9 9 6 11"/>',
};
const G = {
  alert: '⚠', lock: '🔒🔐', unlock: '🔓', shield: '🛡', checkc: '✅', xc: '❌', helpc: '❓', doc: '📄📑📜', docs: '🧾📋', zap: '⚡', refresh: '🔄', repeat: '🔁',
  clip: '📋', bars: '📊', line: '📈', down: '📥⬇', up: '📤', scale: '⚖', pin: '📍📌', card: '💳', folder: '📁📂', cal: '📅🗓', box: '📦',
  eye: '👁👆', eyeoff: '🙈', hour: '⏳', coffee: '☕', phone: '📱📲', search: '🔍🔎', bank: '🏛🏦', user: '👤🧑', users: '👥', printer: '🖨', star: '⭐🌟',
  rocket: '🚀', receipt: '🧾', gear: '⚙', trash: '🗑', clock: '⏱⏰🕐', pencil: '✏✍✎📝', camera: '📷📸', tag: '🏷', spark: '✨✦', ban: '⛔🚫',
  building: '🏢', cash: '💵', plus: '➕', clipx: '📎', target: '🎯', wallet: '💰👛', pause: '⏸', utensils: '🍳🍽🍲🍱🥗🥐🍨🥤', flame: '🔥', save: '💾',
  globe: '🌐', bell: '🔔', expand: '⛶', siren: '🚨', brief: '💼', gift: '🎁', calc: '🧮', grad: '🎓', key: '🔑', book: '📖📗', steth: '🩺', truck: '🚚🚛',
  coins: '💸', call: '📞', crown: '👑', image: '🖼', sun: '☀🌴🏖', moon: '🌙', back: '⌫', puzzle: '🧩', paw: '🐎🐕', store: '🏪🏬', signal: '📡📶', chat: '💬',
  cart: '🛒', bag: '🛍', flask: '🧪🔬', bulb: '💡', vol: '🔊', voloff: '🔇', cut: '✂', bike: '🛵', link: '🔗', monitor: '🖥💻📺', mail: '📬📩📨', home: '🏠',
  sunrise: '🌅🌆', therm: '🌡', hand: '👋🤝', mega: '📢', party: '🎉', cake: '🎂', ticket: '🎟', hash: '🔢', trophy: '🏆', medal: '🏅', diamond: '💎💍',
  stop: '🛑🚧', flag: '🚩', plug: '🔌', shuffle: '🔀', wrench: '🛠🔧', books: '📚', archive: '🗜🗄', brick: '🧱', palette: '🎨', access: '♿', torch: '🔦',
  dice: '🎲', sliders: '🎛', hosp: '🏥', conc: '🛎', leaf: '🌿', bridge: '🌉', grid: '☷', arrleft: '⬅', arrright: '➡', arrne: '↗', undo: '↩', turn: '↳',
  updown: '↕', upload: '⇪', tri: '▲', run: '🏃',
};
const TONE = { checkc: 'ok', xc: 'err', alert: 'warn', ban: 'err', stop: 'err', siren: 'err', shield: 'brand' };
const MAP = new Map();
for (const [name, chars] of Object.entries(G)) for (const ch of [...chars]) MAP.set(ch, name);
// colored dots
const DOT = { '🟢': 'ok', '🔴': 'err', '🟡': 'warn', '⚪': 'mute' };
for (const ch of Object.keys(DOT)) MAP.set(ch, 'dot');

const RE = /(\p{Regional_Indicator}{2})|(\p{Extended_Pictographic}️?|[⛶⌫⬇⬅➡↗↩↳↕⇪▲✎✂✦☷⚪]️?)/gu;
const svg = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.dot}</svg>`;
function iconEl(ch) {
  const flag = /^\p{Regional_Indicator}{2}$/u.test(ch);
  const name = flag ? "flag" : MAP.get(ch.replace(/️/g, ""));
  if (!name) return null;
  const s = document.createElement("span");
  const tone = DOT[ch.replace(/️/g, "")] || TONE[name];
  s.className = "zi" + (tone ? ` zi-${tone}` : "");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = svg(name);
  return s;
}
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "OPTION", "OPTGROUP", "INPUT", "TITLE", "SELECT", "NOSCRIPT"]);
function convertText(node) {
  const text = node.nodeValue;
  RE.lastIndex = 0;
  if (!RE.test(text)) return;
  RE.lastIndex = 0;
  const parent = node.parentElement;
  if (!parent || SKIP.has(parent.tagName) || parent.isContentEditable) { if (parent && (parent.tagName === "OPTION" || parent.tagName === "OPTGROUP")) node.nodeValue = text.replace(RE, (m) => (MAP.has(m.replace(/️/g, "")) ? "" : m)).replace(/^\s+/, ""); return; }
  const frag = document.createDocumentFragment();
  let last = 0, m, changed = false;
  while ((m = RE.exec(text))) {
    const el = iconEl(m[0]);
    if (!el) continue;
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(el); last = m.index + m[0].length; changed = true;
  }
  if (!changed) return;
  if (last < text.length) frag.append(text.slice(last));
  node.replaceWith(frag);
}
function walk(root) {
  if (root.nodeType === 3) return convertText(root);
  if (root.nodeType !== 1 || SKIP.has(root.tagName) || root.classList?.contains("zi")) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && !SKIP.has(n.parentElement.tagName) || n.parentElement?.tagName === "OPTION") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach(convertText);
  root.querySelectorAll?.("[placeholder],[title],[aria-label],option").forEach((el) => {
    for (const a of ["placeholder", "title", "aria-label"]) { const v = el.getAttribute?.(a); if (v) { RE.lastIndex = 0; if (RE.test(v)) { RE.lastIndex = 0; el.setAttribute(a, v.replace(RE, (x) => (MAP.has(x.replace(/️/g, "")) || /^\p{Regional_Indicator}{2}$/u.test(x) ? "" : x)).replace(/\s{2,}/g, " ").trim()); } } }
  });
}
let obs = null;
export function startEmojiIcons() {
  if (obs || typeof MutationObserver === "undefined") return;
  const rootOk = () => !document.getElementById("app")?.classList.contains("auth-screen");
  obs = new MutationObserver((muts) => {
    if (!rootOk()) return;
    for (const m of muts) m.addedNodes.forEach((n) => { try { walk(n); } catch { /* never break a page */ } });
  });
  obs.observe(document.body, { childList: true, subtree: true });
  if (rootOk()) walk(document.body);
}
