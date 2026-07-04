/**
 * One-off migration: fixes the Account.mobile unique index.
 *
 * Why this is needed:
 * The `mobile_1` index in MongoDB was originally built as a plain
 * unique index (before `sparse: true` was added to the schema).
 * Mongoose does NOT retroactively alter an index that already exists
 * just because the schema definition changed — you have to drop and
 * rebuild it yourself. That's why you're still seeing dup-key errors
 * on `mobile: null` even though the schema now says `sparse: true`.
 *
 * This script drops the old index and rebuilds it as a PARTIAL index
 * (safer than `sparse`, because a sparse index still enforces
 * uniqueness on documents where the field is explicitly `null` —
 * it only skips documents where the field is completely absent.
 * A partial index with `$type: "string"` only indexes real values.)
 *
 * Run once: node scripts/fixMobileIndex.js
 */
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Fix DNS for Atlas
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const col = mongoose.connection.collection('accounts');

    // 1. See what indexes currently exist
    const existing = await col.indexes();
    console.log('Existing indexes:', existing.map(i => i.name));

    // 2. Drop the old mobile index if present
    if (existing.some(i => i.name === 'mobile_1')) {
      await col.dropIndex('mobile_1');
      console.log('Dropped old mobile_1 index');
    }

    // 3. (Optional but recommended) Clean up any accounts that already
    //    have mobile explicitly set to null, so they don't collide again.
    const nulled = await col.updateMany(
      { mobile: null },
      { $unset: { mobile: '' } }
    );
    console.log(`Unset explicit null mobile on ${nulled.modifiedCount} account(s)`);

    // 4. Recreate as a partial unique index — only indexes docs where
    //    mobile is an actual string, so missing AND null are both ignored.
    await col.createIndex(
      { mobile: 1 },
      {
        unique: true,
        partialFilterExpression: { mobile: { $type: 'string' } },
        name: 'mobile_1',
      }
    );
    console.log('Recreated mobile_1 as a partial unique index');

    console.log('Done.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await mongoose.disconnect();
  }
})();