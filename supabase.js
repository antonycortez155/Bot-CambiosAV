const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_KEY } = require('./config');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Supabase timeout (${ms}ms)`)), ms)
    ),
  ]);
}

async function dbQuery(builder, ms = 12000) {
  return withTimeout(builder, ms);
}

module.exports = { supabase, withTimeout, dbQuery };
