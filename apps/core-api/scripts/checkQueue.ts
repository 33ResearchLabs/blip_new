import IORedis from 'ioredis';
import { config } from 'dotenv';
config({ path: '../../settle/.env.local' });

async function main() {
  const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    enableReadyCheck: false,
    tls: process.env.REDIS_URL?.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  });

  const waiting = await redis.llen('bull:receiptQueue:wait');
  const active = await redis.llen('bull:receiptQueue:active');
  const failed = await redis.zcard('bull:receiptQueue:failed');
  const completed = await redis.zcard('bull:receiptQueue:completed');
  console.log('Queue stats:', { waiting, active, failed, completed });

  const failedIds = await redis.zrange('bull:receiptQueue:failed', 0, 10);
  for (const jobId of failedIds) {
    const job = await redis.hgetall(`bull:receiptQueue:${jobId}`);
    console.log(`\nFAILED JOB ${jobId}:`);
    console.log('  data:', job.data?.substring(0, 300));
    console.log('  reason:', job.failedReason?.substring(0, 300));
    console.log('  attempts:', job.attemptsMade);
  }

  await redis.quit();
}

main().catch(console.error);
