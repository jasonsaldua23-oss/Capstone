import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function getAllModelNames() {
  return Prisma.dmmf.datamodel.models.map((model) => model.name);
}

function parseModelsArg() {
  const allModels = getAllModelNames();
  if (process.argv.includes('--all')) return allModels;

  const arg = process.argv.find((v) => v.startsWith('--models='));
  if (!arg) return allModels;

  const models = arg
    .replace('--models=', '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  return models.length ? models : allModels;
}

function parseOutputModeArg() {
  return {
    csvOnly: process.argv.includes('--csv-only'),
    singleCsv: process.argv.includes('--single-csv'),
  };
}

function sanitizeForCsv(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsv(value) {
  const text = sanitizeForCsv(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function objectsToCsv(rows) {
  if (!rows.length) return '';

  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const lines = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map((header) => escapeCsv(row[header]));
    lines.push(values.join(','));
  }

  return `${lines.join('\n')}\n`;
}

function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function normalizeRowForCombinedCsv(row, modelName) {
  const output = { __table: modelName };
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      output[key] = value.toISOString();
    } else if (typeof value === 'bigint') {
      output[key] = value.toString();
    } else if (value && typeof value === 'object') {
      output[key] = JSON.stringify(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

async function exportModel(modelName, outputDir, options) {
  const delegateName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const delegate = prisma[delegateName];

  if (!delegate || typeof delegate.findMany !== 'function') {
    throw new Error(`Model '${modelName}' is not available on Prisma Client.`);
  }

  const rows = await delegate.findMany();

  const jsonPath = join(outputDir, `${modelName}.json`);
  const csvPath = join(outputDir, `${modelName}.csv`);

  if (!options.csvOnly) {
    writeFileSync(jsonPath, JSON.stringify(rows, jsonReplacer, 2));
  }
  writeFileSync(csvPath, objectsToCsv(rows));

  return {
    modelName,
    count: rows.length,
    rows,
    jsonPath: options.csvOnly ? null : jsonPath,
    csvPath,
  };
}

async function main() {
  const models = parseModelsArg();
  const options = parseOutputModeArg();
  const outputDir = join(process.cwd(), 'download', 'exports');
  mkdirSync(outputDir, { recursive: true });

  const results = [];
  const combinedRows = [];
  for (const model of models) {
    const result = await exportModel(model, outputDir, options);
    results.push(result);

    if (options.singleCsv) {
      for (const row of result.rows) {
        combinedRows.push(normalizeRowForCombinedCsv(row, result.modelName));
      }
    }
  }

  let combinedCsvPath = null;
  if (options.singleCsv) {
    combinedCsvPath = join(outputDir, 'AllTables.csv');
    writeFileSync(combinedCsvPath, objectsToCsv(combinedRows));
  }

  console.log('Export complete:\n');
  for (const result of results) {
    if (result.jsonPath) {
      console.log(
        `- ${result.modelName}: ${result.count} rows\n  JSON: ${result.jsonPath}\n  CSV:  ${result.csvPath}`
      );
    } else {
      console.log(`- ${result.modelName}: ${result.count} rows\n  CSV:  ${result.csvPath}`);
    }
  }

  if (combinedCsvPath) {
    console.log(`\nCombined CSV: ${combinedCsvPath}`);
  }
}

main()
  .catch((error) => {
    console.error('Export failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
