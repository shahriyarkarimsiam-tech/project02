import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { mintSession } from '../src/auth.mjs';

const SESSION_SECRET = 'test-session-secret-key-32-bytes-long';

async function authHeader(uid = '1001') {
  const token = await mintSession(uid, SESSION_SECRET);
  return { authorization: `Bearer ${token}` };
}

test('health endpoint reports enabled monetization and pool', async () => {
  const result = await worker.fetch(new Request('https://example.com/api/health'), {
    ADS_ACTIVE: 'true',
    ADSGRAM_BLOCK_ID: '59239',
    MONETAG_ZONE_ID: '12239871',
    ONCLICKA_SPOT_ID: '6155185',
    RICHADS_PUB_ID: '1028723',
    RICHADS_SITE_ID: '412421'
  });
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.ok, true);
  assert.equal(data.version, '0.3.0');
  assert.equal(data.adsEnabled, true);
  assert.equal(data.withdrawalsEnabled, true);
  assert.equal(data.adsgramBlockId, '59239');
  assert.equal(data.monetagZoneId, '12239871');
  assert.equal(data.onclickaSpotId, '6155185');
  assert.equal(data.richadsPubId, '1028723');
  assert(data.activeNetworks);
  assert(data.activeNetworks.onclicka);
  assert(data.activeNetworks.richads);
});

test('health endpoint reports adsEnabled: false when no real ads configured', async () => {
  const result = await worker.fetch(new Request('https://example.com/api/health'), {});
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.adsEnabled, false);
});

test('private endpoints refuse requests without signed Telegram session', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/me'), { SESSION_SECRET });
  assert.equal(response.status, 401);
});

test('auth endpoint refuses cross-origin requests', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/auth/telegram', {
    method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}'
  }), {});
  assert.equal(response.status, 403);
});

test('auth endpoint allows Telegram Web cross-origin requests with CORS', async () => {
  const preflight = await worker.fetch(new Request('https://example.com/api/auth/telegram', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://web.telegram.org',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,authorization'
    }
  }), { BOT_TOKEN: 'token', SESSION_SECRET, DB: {} });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://web.telegram.org');
});

test('auth fails closed when secrets or D1 are missing', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/auth/telegram', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  }), {});
  assert.equal(response.status, 503);
});

test('webhook endpoint responds ok to telegram messages', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update_id: 1, message: { chat: { id: 100 }, text: '/start' } })
  }), { BOT_TOKEN: 'fake_bot_token' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('leaderboard returns blocks leaders with mocked D1', async () => {
  const mockDB = {
    prepare(query) {
      assert(query.includes('best_blocks_score') || query.includes('blocks'));
      return {
        async all() {
          return { results: [{ name: 'Alice', score: 450 }] };
        }
      };
    }
  };
  const response = await worker.fetch(new Request('https://example.com/api/leaderboard?game=blocks&mode=classic'), { DB: mockDB });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.game, 'blocks');
  assert.equal(data.mode, 'classic');
  assert.deepEqual(data.leaders, [{ name: 'Alice', score: 450 }]);
});

test('leaderboard returns cascade leaders with mocked D1', async () => {
  const mockDB = {
    prepare(query) {
      assert(query.includes('best_cascade_score') || query.includes('cascade'));
      return {
        async all() {
          return { results: [{ name: 'Bob', score: 1200 }] };
        }
      };
    }
  };
  const response = await worker.fetch(new Request('https://example.com/api/leaderboard?game=cascade&mode=classic'), { DB: mockDB });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.game, 'cascade');
  assert.equal(data.mode, 'classic');
  assert.deepEqual(data.leaders, [{ name: 'Bob', score: 1200 }]);
});

test('leaderboard returns memory leaders with mocked D1', async () => {
  const mockDB = {
    prepare(query) {
      assert(query.includes('best_memory_score') || query.includes('memory'));
      return {
        async all() {
          return { results: [{ name: 'Charlie', score: 15 }] };
        }
      };
    }
  };
  const response = await worker.fetch(new Request('https://example.com/api/leaderboard?game=memory&mode=classic'), { DB: mockDB });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.game, 'memory');
  assert.equal(data.mode, 'classic');
  assert.deepEqual(data.leaders, [{ name: 'Charlie', score: 15 }]);
});

test('leaderboard returns viper leaders with mocked D1', async () => {
  const mockDB = {
    prepare(query) {
      assert(query.includes('best_viper_score') || query.includes('viper'));
      return {
        async all() {
          return { results: [{ name: 'Diana', score: 850 }] };
        }
      };
    }
  };
  const response = await worker.fetch(new Request('https://example.com/api/leaderboard?game=viper&mode=classic'), { DB: mockDB });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.game, 'viper');
  assert.equal(data.mode, 'classic');
  assert.deepEqual(data.leaders, [{ name: 'Diana', score: 850 }]);
});

test('GET /api/ads/pool returns weekly pool data and user calculations', async () => {
  const auth = await authHeader('1001');
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM players')) {
                return { stars: 50, weekly_stars: 20, usdt_balance: 1.50, last_ad_at: Math.floor(Date.now() / 1000) - 100, payout_wallet: 'UQTestWallet' };
              }
              if (query.includes('FROM weekly_pools')) {
                return { total_stars: 1000, total_revenue_usdt: 20.0, community_pool_usdt: 10.0, value_per_star: 0.01, status: 'active' };
              }
              if (query.includes('FROM ad_impressions')) {
                return { count: 5 };
              }
              return null;
            }
          };
        },
        async all() {
          return { results: [{ weekId: '2026-W45', totalStars: 5000, communityPoolUsdt: 50.0, valuePerStar: 0.01, settledAt: 1794200000 }] };
        }
      };
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/ads/pool', {
    headers: { ...auth }
  }), { DB: mockDB, SESSION_SECRET });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert(data.weekId.startsWith('20'));
  assert.equal(data.settlementDay, 'Friday');
  assert.equal(data.communityTotalStars, 1000);
  assert.equal(data.communityPoolUsdt, 10.0);
  assert.equal(data.estimatedValuePerStar, 0.01);
  assert.equal(data.userWeeklyStars, 20);
  assert.equal(data.userTotalStars, 50);
  assert.equal(data.userEstimatedShareUsdt, 0.20);
  assert.equal(data.userUsdtBalance, 1.50);
  assert.equal(data.adsWatchedToday, 5);
  assert.equal(data.dailyCap, 20);
  assert.equal(data.cooldownSecondsRemaining, 0);
  assert.equal(data.minWithdrawalUsdt, 10.00);
  assert.equal(data.payoutWallet, 'UQTestWallet');
  assert.equal(data.pastSettlements.length, 1);
});

test('POST /api/ads/claim enforces 60s cooldown', async () => {
  const auth = await authHeader('1001');
  const nowSec = Math.floor(Date.now() / 1000);
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM players')) {
                // last ad was 10 seconds ago -> cooldown still active
                return { stars: 5, weekly_stars: 5, usdt_balance: 0, last_ad_at: nowSec - 10 };
              }
              return null;
            }
          };
        }
      };
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'direct' })
  }), { DB: mockDB, SESSION_SECRET, ADS_ACTIVE: 'true' });

  assert.equal(response.status, 429);
  const data = await response.json();
  assert(data.error.includes('Ad cooldown active'));
});

test('POST /api/ads/claim enforces 20 ads per 24 hours daily cap', async () => {
  const auth = await authHeader('1001');
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM players')) {
                return { stars: 20, weekly_stars: 20, usdt_balance: 0, last_ad_at: 0 };
              }
              if (query.includes('FROM ad_impressions')) {
                return { count: 20 }; // reached daily cap
              }
              return null;
            }
          };
        }
      };
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'direct' })
  }), { DB: mockDB, SESSION_SECRET, ADS_ACTIVE: 'true' });

  assert.equal(response.status, 429);
  const data = await response.json();
  assert(data.error.includes('Daily ad limit reached'));
});

test('POST /api/ads/claim successfully awards 1 star and records impression', async () => {
  const auth = await authHeader('1001');
  let batchCalled = false;
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('SELECT stars, weekly_stars, usdt_balance, last_ad_at FROM players')) {
                return { stars: 4, weekly_stars: 4, usdt_balance: 0, last_ad_at: 0 };
              }
              if (query.includes('SELECT COUNT(*) AS count FROM ad_impressions')) {
                return { count: 2 };
              }
              if (query.includes('SELECT stars, weekly_stars, usdt_balance FROM players')) {
                return { stars: 5, weekly_stars: 5, usdt_balance: 0 };
              }
              return null;
            }
          };
        }
      };
    },
    async batch(stmts) {
      assert.equal(stmts.length, 3);
      batchCalled = true;
      return [];
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'direct' })
  }), { DB: mockDB, SESSION_SECRET, ADS_ACTIVE: 'true' });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.rewardStars, 1);
  assert.equal(data.stars, 5);
  assert.equal(data.weeklyStars, 5);
  assert.equal(data.adsToday, 3);
  assert(batchCalled);
});

test('POST /api/wallet/withdraw validates minimum amount and balance', async () => {
  const auth = await authHeader('1001');
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              return { usdt_balance: 10.50, referrals_count: 10, has_withdrawn: 0 };
            }
          };
        }
      };
    }
  };

  // Rejects below $10.00
  const underMinResp = await worker.fetch(new Request('https://example.com/api/wallet/withdraw', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 5.00, network: 'BEP-20', address: '0x71C8363837918fb41999e07d72c3dE2C4407D871' })
  }), { DB: mockDB, SESSION_SECRET });
  assert.equal(underMinResp.status, 400);

  // Rejects invalid BEP-20 address
  const invalidAddrResp = await worker.fetch(new Request('https://example.com/api/wallet/withdraw', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 10.00, network: 'BEP-20', address: 'bad-address-format' })
  }), { DB: mockDB, SESSION_SECRET });
  assert.equal(invalidAddrResp.status, 400);

  // Rejects when balance is less than requested amount
  const overBalResp = await worker.fetch(new Request('https://example.com/api/wallet/withdraw', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 15.00, network: 'BEP-20', address: '0x71C8363837918fb41999e07d72c3dE2C4407D871' })
  }), { DB: mockDB, SESSION_SECRET });
  assert.equal(overBalResp.status, 400);
  const err = await overBalResp.json();
  assert.equal(err.error, 'Insufficient USDT balance');
});

test('POST /api/wallet/withdraw rejects first withdrawal if user has fewer than 10 referrals', async () => {
  const auth = await authHeader('1001');
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              return { usdt_balance: 50.00, referrals_count: 7, has_withdrawn: 0 };
            }
          };
        }
      };
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/wallet/withdraw', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 10.00, network: 'BEP-20', address: '0x71C8363837918fb41999e07d72c3dE2C4407D871' })
  }), { DB: mockDB, SESSION_SECRET });

  assert.equal(response.status, 403);
  const data = await response.json();
  assert(data.error.includes('Withdrawal locked. You need at least 10 users invited under your referral link'));
});

test('POST /api/wallet/withdraw allows withdrawal once user has 10+ referrals or has already completed 1st withdrawal', async () => {
  const auth = await authHeader('1001');
  let batchCalled = false;
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('WHERE id=?')) {
                // subsequent withdrawal: has_withdrawn is 1 even if current count is under 10
                return { usdt_balance: 30.00, referrals_count: 5, has_withdrawn: 1 };
              }
              return null;
            }
          };
        }
      };
    },
    async batch(stmts) {
      assert.equal(stmts.length, 2);
      batchCalled = true;
      return [];
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/wallet/withdraw', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 10.00, network: 'BEP-20', address: '0x71C8363837918fb41999e07d72c3dE2C4407D871' })
  }), { DB: mockDB, SESSION_SECRET });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert(batchCalled);
});

test('POST /api/wallet/withdraw processes valid withdrawal request with 10 referrals', async () => {
  const auth = await authHeader('1001');
  let batchCalled = false;
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('WHERE id=?')) {
                return { usdt_balance: 25.00, referrals_count: 10, has_withdrawn: 0 };
              }
              return null;
            }
          };
        }
      };
    },
    async batch(stmts) {
      assert.equal(stmts.length, 2);
      batchCalled = true;
      return [];
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/wallet/withdraw', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 15.00, network: 'BEP-20', address: '0x71C8363837918fb41999e07d72c3dE2C4407D871' })
  }), { DB: mockDB, SESSION_SECRET });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.amount, 15.00);
  assert.equal(data.network, 'BEP-20');
  assert.equal(data.status, 'pending');
  assert(batchCalled);
});

test('POST /api/admin/settle-week distributes 50% pool share', async () => {
  const auth = await authHeader('9999'); // admin ID
  let batchExecuted = false;
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM weekly_pools')) {
                return { total_stars: 1000 };
              }
              return null;
            }
          };
        }
      };
    },
    async batch(stmts) {
      assert.equal(stmts.length, 2);
      batchExecuted = true;
      return [];
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/admin/settle-week', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ weekId: '2026-W46', adRevenueUsdt: 100.0 })
  }), { DB: mockDB, SESSION_SECRET, ADMIN_TELEGRAM_ID: '9999' });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.weekId, '2026-W46');
  assert.equal(data.settlementDay, 'Friday');
  assert.equal(data.totalRevenueUsdt, 100.0);
  assert.equal(data.communityPoolUsdt, 50.0);
  assert.equal(data.totalStars, 1000);
  assert.equal(data.valuePerStar, 0.05);
  assert(batchExecuted);
});

test('POST /api/admin/settle-week supports direct custom valuePerStar', async () => {
  const auth = await authHeader('9999');
  let batchExecuted = false;
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM weekly_pools')) return { total_stars: 500 };
              return null;
            }
          };
        }
      };
    },
    async batch(stmts) {
      assert.equal(stmts.length, 2);
      batchExecuted = true;
      return [];
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/admin/settle-week', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ weekId: '2026-W46', valuePerStar: 0.025 })
  }), { DB: mockDB, SESSION_SECRET, ADMIN_TELEGRAM_ID: '9999' });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.valuePerStar, 0.025);
  assert.equal(data.totalStars, 500);
  assert.equal(data.communityPoolUsdt, 12.5); // 500 * 0.025
  assert(batchExecuted);
});

test('GET /api/admin/pool-summary returns live metrics to authorized admin', async () => {
  const auth = await authHeader('9999');
  const mockDB = {
    prepare(query) {
      const stmt = {
        bind(...args) { return stmt; },
        async first() {
          if (query.includes('FROM weekly_pools')) {
            return { total_stars: 800, total_revenue_usdt: 16.0, community_pool_usdt: 8.0 };
          }
          if (query.includes('FROM players WHERE weekly_stars > 0')) {
            return { count: 42 };
          }
          return null;
        }
      };
      return stmt;
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/admin/pool-summary', {
    headers: auth
  }), { DB: mockDB, SESSION_SECRET, ADMIN_TELEGRAM_ID: '9999' });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.totalStars, 800);
  assert.equal(data.eligiblePlayers, 42);
  assert.equal(data.communityPoolUsdt, 8.0);
  assert.equal(data.currentRatio, 0.01);
});

test('handleScheduled acts strictly as reminder and NEVER auto-settles without confirmation', async () => {
  const { handleScheduled } = await import('../src/worker.mjs');
  let batchRan = false;
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM weekly_pools')) {
                return { total_stars: 2000, total_revenue_usdt: 40.0, community_pool_usdt: 20.0, status: 'active' };
              }
              if (query.includes('FROM system_settings')) {
                return { value: '9999' };
              }
              return null;
            }
          };
        }
      };
    },
    async batch() {
      // Must NEVER be called!
      batchRan = true;
      return [];
    }
  };

  await handleScheduled({}, { DB: mockDB, ADMIN_TELEGRAM_ID: '9999' });
  // Verify that batch settlement did NOT run:
  assert.equal(batchRan, false);
});

test('GET /api/wallet/history returns user withdrawal requests', async () => {
  const auth = await authHeader('1001');
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async all() {
              return {
                results: [
                  {
                    id: 'wd_12345',
                    amount: 15.00,
                    network: 'BEP-20',
                    address: '0x1234567890123456789012345678901234567890',
                    status: 'pending',
                    requestedAt: 1731326400,
                    processedAt: null,
                    txHash: null,
                    rejectionReason: null
                  }
                ]
              };
            }
          };
        }
      };
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/wallet/history', {
    headers: auth
  }), { DB: mockDB, SESSION_SECRET });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.requests.length, 1);
  assert.equal(data.requests[0].id, 'wd_12345');
  assert.equal(data.requests[0].status, 'pending');
});

test('POST /api/admin/withdrawal/complete updates status and txHash', async () => {
  const auth = await authHeader('9999');
  let updateRan = false;
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM withdrawal_requests WHERE id=?')) {
                return {
                  id: 'wd_123',
                  player_id: 'player1',
                  amount_usdt: 20.0,
                  network: 'BEP-20',
                  wallet_address: '0x1234567890123456789012345678901234567890',
                  status: 'pending'
                };
              }
              return null;
            },
            async run() {
              if (query.includes('UPDATE withdrawal_requests SET status="completed"')) {
                updateRan = true;
              }
              return { success: true };
            }
          };
        }
      };
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/admin/withdrawal/complete', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'wd_123', txHash: '0xabcdef1234567890' })
  }), { DB: mockDB, SESSION_SECRET, ADMIN_TELEGRAM_ID: '9999' });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.status, 'completed');
  assert.equal(data.txHash, '0xabcdef1234567890');
  assert(updateRan);
});

test('POST /api/admin/withdrawal/reject refunds user balance', async () => {
  const auth = await authHeader('9999');
  let batchRan = false;
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM withdrawal_requests WHERE id=?')) {
                return {
                  id: 'wd_456',
                  player_id: 'player1',
                  amount_usdt: 12.0,
                  network: 'BEP-20',
                  wallet_address: '0x1234567890123456789012345678901234567890',
                  status: 'pending'
                };
              }
              return null;
            }
          };
        }
      };
    },
    async batch(stmts) {
      assert.equal(stmts.length, 2);
      batchRan = true;
      return [];
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/admin/withdrawal/reject', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'wd_456', reason: 'Invalid address' })
  }), { DB: mockDB, SESSION_SECRET, ADMIN_TELEGRAM_ID: '9999' });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.status, 'rejected');
  assert.equal(data.rejectionReason, 'Invalid address');
  assert(batchRan);
});

test('POST /api/ads/claim supports multi-network tracking', async () => {
  const auth = await authHeader('1001');
  let recordedNetwork = null;
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM players WHERE id=?')) {
                return { stars: 5, weekly_stars: 3, usdt_balance: 0.0, last_ad_at: 0 };
              }
              if (query.includes('SELECT COUNT(*) AS count FROM ad_impressions')) {
                return { count: 2 };
              }
              return null;
            }
          };
        }
      };
    },
    async batch(stmts) {
      return [];
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'monetag' })
  }), { DB: mockDB, SESSION_SECRET, ADS_ACTIVE: 'true' });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.network, 'monetag');
  assert.equal(data.rewardStars, 1);

  // Test Adsun network claim
  const adsunResp = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'adsun' })
  }), { DB: mockDB, SESSION_SECRET, ADSUN_BLOCK_ID: '50194' });
  assert.equal(adsunResp.status, 200);
  const adsunData = await adsunResp.json();
  assert.equal(adsunData.ok, true);
  assert.equal(adsunData.network, 'adsun');
  assert.equal(adsunData.rewardStars, 1);

  // Test GigaPub network claim
  const gigaResp = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'gigapub' })
  }), { DB: mockDB, SESSION_SECRET, GIGAPUB_APP_ID: '9103' });
  assert.equal(gigaResp.status, 200);
  const gigaData = await gigaResp.json();
  assert.equal(gigaData.ok, true);
  assert.equal(gigaData.network, 'gigapub');
  assert.equal(gigaData.rewardStars, 1);

  // Test Adsterra network claim
  const adsterraResp = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'adsterra' })
  }), { DB: mockDB, SESSION_SECRET, ADSTERRA_ZONE_ID: '32219036' });
  assert.equal(adsterraResp.status, 200);
  const adsterraData = await adsterraResp.json();
  assert.equal(adsterraData.ok, true);
  assert.equal(adsterraData.network, 'adsterra');
  assert.equal(adsterraData.rewardStars, 1);

  // Test AdsGram network claim
  const adsgramResp = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'adsgram' })
  }), { DB: mockDB, SESSION_SECRET, ADSGRAM_BLOCK_ID: '59239' });
  assert.equal(adsgramResp.status, 200);
  const adsgramData = await adsgramResp.json();
  assert.equal(adsgramData.ok, true);
  assert.equal(adsgramData.network, 'adsgram');
  assert.equal(adsgramData.rewardStars, 1);

  // Test OnClickA network claim
  const onclickaResp = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'onclicka' })
  }), { DB: mockDB, SESSION_SECRET, ONCLICKA_SPOT_ID: '6155185' });
  assert.equal(onclickaResp.status, 200);
  const onclickaData = await onclickaResp.json();
  assert.equal(onclickaData.ok, true);
  assert.equal(onclickaData.network, 'onclicka');
  assert.equal(onclickaData.rewardStars, 1);

  // Test RichAds network claim
  const richadsResp = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'richads' })
  }), { DB: mockDB, SESSION_SECRET, RICHADS_PUB_ID: '1028723' });
  assert.equal(richadsResp.status, 200);
  const richadsData = await richadsResp.json();
  assert.equal(richadsData.ok, true);
  assert.equal(richadsData.network, 'richads');
  assert.equal(richadsData.rewardStars, 1);

  // Test TADS network claim
  const tadsResp = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'tads' })
  }), { DB: mockDB, SESSION_SECRET, TADS_WIDGET_ID: '13243' });
  assert.equal(tadsResp.status, 200);
  const tadsData = await tadsResp.json();
  assert.equal(tadsData.ok, true);
  assert.equal(tadsData.network, 'tads');
  assert.equal(tadsData.rewardStars, 1);

  // Test Adexium network claim
  const adexiumResp = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'adexium' })
  }), { DB: mockDB, SESSION_SECRET, ADEXIUM_WID: '4672c32d-e0b9-41f8-976d-c7ccc51ac091' });
  assert.equal(adexiumResp.status, 200);
  const adexiumData = await adexiumResp.json();
  assert.equal(adexiumData.ok, true);
  assert.equal(adexiumData.network, 'adexium');
  assert.equal(adexiumData.rewardStars, 1);
});

test('POST /api/ads/claim rejects with 400 when no real ads configured', async () => {
  const auth = await authHeader('1001');
  const mockDB = { prepare() { return { bind() { return { async first() { return { id: '1001' }; } }; } }; } };
  const response = await worker.fetch(new Request('https://example.com/api/ads/claim', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'direct' })
  }), { DB: mockDB, SESSION_SECRET });
  assert.equal(response.status, 400);
  const data = await response.json();
  assert(data.error.includes('No active real ad network configured'));
});

test('GET /api/admin/ads-summary returns network breakdown', async () => {
  const auth = await authHeader('9999');
  const mockDB = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() {
              if (query.includes('FROM ad_impressions WHERE week_id=?')) {
                return { impressions: 15, starsAwarded: 15 };
              }
              return null;
            }
          };
        },
        async all() {
          if (query.includes('GROUP BY ad_network')) {
            return {
              results: [
                { network: 'monetag', impressions: 10, starsAwarded: 10 },
                { network: 'adsgram', impressions: 5, starsAwarded: 5 }
              ]
            };
          }
          return { results: [] };
        },
        async first() {
          return { impressions: 25, starsAwarded: 25 };
        }
      };
    }
  };

  const response = await worker.fetch(new Request('https://example.com/api/admin/ads-summary', {
    headers: auth
  }), { DB: mockDB, SESSION_SECRET, ADMIN_TELEGRAM_ID: '9999' });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert(Array.isArray(data.supportedNetworks));
  assert(data.supportedNetworks.includes('monetag'));
  assert(data.supportedNetworks.includes('adsgram'));
  assert(data.supportedNetworks.includes('adsterra'));
  assert(data.supportedNetworks.includes('taskkit'));
  assert.equal(data.networkBreakdown.length, 2);
});

test('webhook endpoint responds to /taskkit and /earn commands', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update_id: 2, message: { chat: { id: 101 }, text: '/taskkit' } })
  }), { BOT_TOKEN: 'fake_bot_token' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('webhook endpoint handles /pool, /help, /myid, /claim_admin, /settle_preview, /rate commands without crashing', async () => {
  const mockDB = {
    prepare(query) {
      const stmt = {
        bind(...args) { return stmt; },
        async first() {
          if (query.includes('FROM weekly_pools')) {
            return { total_stars: 120, community_pool_usdt: 12.0 };
          }
          if (query.includes('FROM players WHERE weekly_stars > 0')) {
            return { count: 8, totalActiveStars: 120, totalStars: 120 };
          }
          if (query.includes('FROM system_settings')) {
            return null; // no admin set yet
          }
          return null;
        },
        async run() {
          return { success: true };
        }
      };
      return stmt;
    },
    async batch(stmts) {
      return [];
    }
  };

  const commands = ['/pool', '/help', '/myid', '/claim_admin', '/settle_preview', '/rate 0.025'];
  for (const cmd of commands) {
    const res = await worker.fetch(new Request('https://example.com/api/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 10, message: { chat: { id: 101 }, from: { first_name: 'Test' }, text: cmd } })
    }), { BOT_TOKEN: 'fake_bot_token', DB: mockDB, ADMIN_TELEGRAM_ID: '101' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  }
});

test('POST & GET /api/ads/postback handles Monetag ymid and estimated_price macros', async () => {
  let batchStatements = 0;
  const mockDB = {
    prepare(query) {
      const stmt = {
        bind(...args) { return stmt; },
        async first() {
          if (query.includes('FROM players WHERE id=?')) {
            return { id: 'user_monetag_1', stars: 2, weekly_stars: 2, last_ad_at: 0 };
          }
          if (query.includes('FROM ad_impressions WHERE id=?')) {
            return null; // not existing yet
          }
          return null;
        }
      };
      return stmt;
    },
    async batch(stmts) {
      batchStatements = stmts.length;
      return [];
    }
  };

  // 1. GET postback format with Monetag macros
  const getRes = await worker.fetch(new Request('https://example.com/api/ads/postback?network=monetag&ymid=user_monetag_1&estimated_price=0.035&event_type=impression&transaction_id=tx_999'), {
    DB: mockDB
  });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.ok, true);
  assert.equal(getData.reward, 1);
  assert.equal(getData.user_id, 'user_monetag_1');
  assert.equal(getData.network, 'monetag');
  assert.equal(getData.revenueRecorded, 0.035);
  assert.equal(batchStatements, 4);

  // 2. Duplicate transaction_id check
  const dupDB = {
    prepare(query) {
      const stmt = {
        bind(...args) { return stmt; },
        async first() {
          if (query.includes('FROM players WHERE id=?')) {
            return { id: 'user_monetag_1', stars: 3, weekly_stars: 3 };
          }
          if (query.includes('FROM ad_impressions WHERE id=?')) {
            return { id: 'tx_tx_999' }; // already exists!
          }
          return null;
        }
      };
      return stmt;
    }
  };
  const dupRes = await worker.fetch(new Request('https://example.com/api/ads/postback?network=monetag&ymid=user_monetag_1&transaction_id=tx_999'), {
    DB: dupDB
  });
  assert.equal(dupRes.status, 200);
  const dupData = await dupRes.json();
  assert.equal(dupData.ok, true);
  assert.equal(dupData.duplicate, true);
});
