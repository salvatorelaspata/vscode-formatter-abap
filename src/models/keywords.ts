import { readFileSync } from 'fs';
const jsonKeywords: { key: string[] } = JSON.parse(readFileSync(__dirname + '\\keywords.json', 'utf8'));
const aSorted = jsonKeywords.key.sort((a: string, b: string) => b.length - a.length);
const sJoined = aSorted.join('|');

export const keywords: (keywordsToLowerCase: boolean) => RegExp =
    (keywordsToLowerCase) => {
        const sKewords = !keywordsToLowerCase ?
            sJoined.toLowerCase() :
            sJoined.toUpperCase();
        return new RegExp(`/${sKewords}/g`);
    };