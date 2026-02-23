import { bootstrapLocalTable } from './dynamo-bootstrap';

const noSeed = process.argv.includes('--no-seed');
const seedCustomer = !noSeed;

bootstrapLocalTable({ seedCustomer })
  .then(() => {
    if (seedCustomer) {
      console.log('Seed completed.');
    }
  })
  .catch((error: unknown) => {
    console.error('Failed to create DynamoDB table', error);
    process.exitCode = 1;
  });
