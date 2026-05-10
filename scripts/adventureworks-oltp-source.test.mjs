import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('AdventureWorks OLTP benchmark source metadata', () => {
  it('pins the full OLTP source instead of the lightweight LT source', () => {
    const source = JSON.parse(readFileSync(new URL('./adventureworks-oltp-source.json', import.meta.url), 'utf8'));

    assert.equal(source.id, 'adventureworks_oltp_with_declared_metadata');
    assert.equal(source.displayName, 'AdventureWorks OLTP (SQL Server 2022, declared metadata)');
    assert.equal(
      source.installScriptUrl,
      'https://github.com/microsoft/sql-server-samples/releases/download/adventureworks/AdventureWorks-oltp-install-script.zip',
    );
    assert.equal(source.installScriptSha256, '58962e94ea386ef7cd3d8a08211bfd42a79d9b81bdd68fd4b6b0051de6c5bd42'); // pragma: allowlist secret
    assert.equal(source.license, 'MIT');
    assert.equal(source.source, 'https://github.com/microsoft/sql-server-samples/tree/master/samples/databases/adventure-works');
    assert.equal(source.expectedTables, 71);
    assert.equal(source.expectedPrimaryKeys, 71);
    assert.equal(source.expectedForeignKeys, 90);
    assert.equal(source.expectedCsvFiles, 69);
    assert.match(source.notes, /full OLTP/i);
    assert.doesNotMatch(JSON.stringify(source), /AdventureWorksLT\.db|Release-1_0_0|nuitsjp/);
  });
});
