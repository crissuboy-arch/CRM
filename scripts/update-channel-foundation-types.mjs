/**
 * Atualiza somente as tabelas da PHASE 1 com a saída oficial de
 * `supabase gen types typescript --db-url ... --schema public`.
 * Preserva schemas Supabase auxiliares, ausentes no Postgres do harness.
 * Nenhum tipo de coluna é escrito à mão: ambos os nós vêm da introspecção.
 * Uso: node scripts/update-channel-foundation-types.mjs arquivo-gerado.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const generatedPath = process.argv[2];
if (!generatedPath) throw new Error("Informe a saída oficial de supabase gen types.");
const targetPath = "lib/database.types.ts";
const originalText = readFileSync(targetPath, "utf8");
const generatedText = readFileSync(generatedPath, "utf8");
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
const original = parse(targetPath, originalText);
const generated = parse(generatedPath, generatedText);

function tables(source) {
  const database = source.statements.find((node) => ts.isTypeAliasDeclaration(node) && node.name.text === "Database");
  const member = (type, name) => {
    if (!type || !ts.isTypeLiteralNode(type)) throw new Error(`Tipo ${name} ausente.`);
    const found = type.members.find((node) => ts.isPropertySignature(node) && node.name.getText(source).replaceAll('"', "") === name);
    if (!found) throw new Error(`Membro ${name} ausente.`);
    return found.type;
  };
  const result = member(member(database?.type, "public"), "Tables");
  if (!result || !ts.isTypeLiteralNode(result)) throw new Error("Tables inválido.");
  return result;
}

const oldTables = tables(original);
const newTables = tables(generated);
const edits = [];
for (const name of ["channel_sessions", "contact_channel_identities"]) {
  const find = (list, source) => list.members.find((node) => ts.isPropertySignature(node) && node.name.getText(source) === name);
  const fresh = find(newTables, generated);
  if (!fresh) throw new Error(`A introspecção não retornou ${name}.`);
  const previous = find(oldTables, original);
  if (previous) {
    edits.push({ start: previous.getStart(original), end: previous.end, text: fresh.getText(generated) });
  } else {
    const next = oldTables.members.find((node) => ts.isPropertySignature(node) && node.name.getText(original) > name);
    const start = next?.getStart(original);
    if (start === undefined) throw new Error("Tables original vazio.");
    edits.push({ start, end: start, text: `${fresh.getText(generated)}\n      ` });
  }
}
let output = originalText;
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
}
writeFileSync(targetPath, output);
