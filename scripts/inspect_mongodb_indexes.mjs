import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'Backend');
const require = createRequire(path.resolve(backendDir, 'package.json'));

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

// Models
const { Bill } = require('./src/models/Bill');
const { InventoryLot } = require('./src/models/InventoryLot');
const { IdempotencyRecord } = require('./src/models/IdempotencyRecord');
const { RegisterSession } = require('./src/models/RegisterSession');
const { CashTransaction } = require('./src/models/CashTransaction');
const { StockMovement } = require('./src/models/StockMovement');
const { StatutoryRule } = require('./src/models/StatutoryRule');
const { Cafe } = require('./src/models/Cafe');
const { User } = require('./src/models/User');

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await replSet.waitUntilRunning();
  await mongoose.connect(replSet.getUri());

  const models = [
    { name: 'Bill', model: Bill },
    { name: 'InventoryLot', model: InventoryLot },
    { name: 'IdempotencyRecord', model: IdempotencyRecord },
    { name: 'RegisterSession', model: RegisterSession },
    { name: 'CashTransaction', model: CashTransaction },
    { name: 'StockMovement', model: StockMovement },
    { name: 'StatutoryRule', model: StatutoryRule },
    { name: 'Cafe', model: Cafe },
    { name: 'User', model: User },
  ];

  console.log('======================================================================');
  console.log('            MONGODB REPLICA SET INDEX AUDIT REPORT');
  console.log('======================================================================\n');

  for (const { name, model } of models) {
    if (!model) continue;
    try {
      await model.createCollection();
      await model.syncIndexes();
      const indexes = await model.collection.getIndexes();
      console.log(`Collection: ${model.collection.name} (Model: ${name})`);
      for (const [idxName, idxSpec] of Object.entries(indexes)) {
        const keys = idxSpec.map ? idxSpec.map(k => `${k[0]}:${k[1]}`).join(', ') : JSON.stringify(idxSpec[0]);
        const unique = idxSpec[1]?.unique ? ' [UNIQUE]' : '';
        const sparse = idxSpec[1]?.sparse ? ' [SPARSE]' : '';
        console.log(`  - ${idxName}: { ${keys} }${unique}${sparse}`);
      }
      console.log('');
    } catch (err) {
      console.log(`Collection: ${name} -> Error syncing indexes: ${err.message}\n`);
    }
  }

  await mongoose.disconnect();
  await replSet.stop();
}

main().catch(console.error);
