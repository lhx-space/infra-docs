import {PrismaPg} from '@prisma/adapter-pg';
import {env} from '../env';
import {PrismaClient} from '../generated/prisma/client';
import {logger} from '../logger';

const adapter = new PrismaPg({connectionString: env.DATABASE_URL});

export const prisma = new PrismaClient({
  adapter,
  log: ['warn', 'error']
});

prisma
  .$connect()
  .then(() => logger.info('prisma connected'))
  .catch((err: unknown) => logger.error({err}, 'prisma connect failed'));
