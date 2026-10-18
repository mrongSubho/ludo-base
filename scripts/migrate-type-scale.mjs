import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);

if (files.length === 0) {
    console.error('Usage: node scripts/migrate-type-scale.mjs <file1> <file2> ...');
    process.exit(1);
}

const map = [
    { pattern: /\btext-\[10px\]/g, replacement: 'text-ludo-xs' },
    { pattern: /\btext-\[11px\]/g, replacement: 'text-ludo-sm' },
    { pattern: /\btext-\[12px\]/g, replacement: 'text-ludo-md' },
    { pattern: /\btext-\[13px\]/g, replacement: 'text-ludo-md' },
    { pattern: /\btext-\[14px\]/g, replacement: 'text-ludo-lg' },
    { pattern: /\btext-\[15px\]/g, replacement: 'text-ludo-lg' },
];

let totalReplaced = 0;

for (const file of files) {
    let content = readFileSync(file, 'utf8');
    let replacedInFile = 0;

    for (const { pattern, replacement } of map) {
        const matches = (content.match(pattern) || []).length;
        if (matches > 0) {
            content = content.replace(pattern, replacement);
            replacedInFile += matches;
        }
    }

    if (replacedInFile > 0) {
        writeFileSync(file, content, 'utf8');
        console.log(`Updated ${file}: ${replacedInFile} replacements`);
        totalReplaced += replacedInFile;
    }
}

console.log(`Total replacements: ${totalReplaced}`);
