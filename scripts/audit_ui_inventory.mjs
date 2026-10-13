import fs from 'node:fs';
import path from 'node:path';

const pagesDir = path.resolve('frontend/src/js/pages');
const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.js'));

const detailedInventory = {};
let totalButtons = 0;
let totalInputs = 0;
let totalSelects = 0;
let totalTables = 0;

files.forEach(file => {
  const code = fs.readFileSync(path.join(pagesDir, file), 'utf8');
  const lines = code.split('\n').length;
  
  // Extract buttons
  const buttons = [];
  const bRegex = /<button([^>]*)>([\s\S]*?)<\/button>/gi;
  let match;
  while ((match = bRegex.exec(code)) !== null) {
    const attrs = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const classMatch = attrs.match(/class=["']([^"']+)["']/i);
    buttons.push({
      id: idMatch ? idMatch[1] : null,
      class: classMatch ? classMatch[1] : null,
      label: text || '(icon/graphic)'
    });
  }

  // Extract inputs
  const inputs = [];
  const iRegex = /<input([^>]*)>/gi;
  while ((match = iRegex.exec(code)) !== null) {
    const attrs = match[1];
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
    const phMatch = attrs.match(/placeholder=["']([^"']+)["']/i);
    inputs.push({
      id: idMatch ? idMatch[1] : null,
      type: typeMatch ? typeMatch[1] : 'text',
      placeholder: phMatch ? phMatch[1] : null
    });
  }

  // Extract selects
  const selects = [];
  const sRegex = /<select([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((match = sRegex.exec(code)) !== null) {
    const attrs = match[1];
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const options = (match[2].match(/<option[^>]*>([\s\S]*?)<\/option>/gi) || []).map(o => o.replace(/<[^>]+>/g, '').trim());
    selects.push({
      id: idMatch ? idMatch[1] : null,
      optionsCount: options.length,
      sampleOptions: options.slice(0, 8)
    });
  }

  // Extract tables
  const tables = (code.match(/<table/gi) || []).length;

  totalButtons += buttons.length;
  totalInputs += inputs.length;
  totalSelects += selects.length;
  totalTables += tables;

  detailedInventory[file] = {
    lines,
    buttonsCount: buttons.length,
    buttonsSample: buttons.slice(0, 15),
    inputsCount: inputs.length,
    inputsSample: inputs.slice(0, 15),
    selectsCount: selects.length,
    selectsSample: selects.slice(0, 10),
    tablesCount: tables
  };
});

const routerCode = fs.readFileSync('frontend/src/js/router.js', 'utf8');
const rRegex = /case\s+["']([^"']+)["']:/g;
const routerCases = [];
let rMatch;
while ((rMatch = rRegex.exec(routerCode)) !== null) {
  routerCases.push(rMatch[1]);
}
const uniqueRouterRoutes = [...new Set(routerCases)].sort();

const settingsSections = [
  'profile', 'employment', 'access', 'delegation', 'security',
  'devices', 'recovery', 'notifications', 'language', 'appearance',
  'accessibility', 'workspace', 'privacy', 'connected', 'updates',
  'help', 'trash', 'admin'
];

const report = {
  summary: {
    totalPageFiles: files.length,
    totalLines: Object.values(detailedInventory).reduce((acc, c) => acc + c.lines, 0),
    totalButtons,
    totalInputs,
    totalSelects,
    totalTables,
    totalRouterCases: routerCases.length,
    uniqueRouterRoutesCount: uniqueRouterRoutes.length,
    uniqueRouterRoutes,
    settingsSections
  },
  pages: detailedInventory
};

fs.writeFileSync('docs/ui_control_inventory.json', JSON.stringify(report, null, 2));
console.log('UI Inventory generated:');
console.log(JSON.stringify(report.summary, null, 2));
