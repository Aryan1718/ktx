import { describe, expect, it } from 'vitest';
import {
  normalizeKloRelationshipName,
  pluralizeKloRelationshipToken,
  singularizeKloRelationshipToken,
  tokenSimilarity,
  tokenizeKloRelationshipName,
} from './relationship-name-similarity.js';

describe('relationship name similarity', () => {
  it('tokenizes common warehouse naming styles', () => {
    expect(normalizeKloRelationshipName('AlbumId')).toMatchObject({
      normalized: 'album_id',
      singular: 'album_id',
      plural: 'album_ids',
      tokens: ['album', 'id'],
    });
    expect(normalizeKloRelationshipName('artistID')).toMatchObject({
      normalized: 'artist_id',
      tokens: ['artist', 'id'],
    });
    expect(normalizeKloRelationshipName('SalesLT.CustomerID')).toMatchObject({
      normalized: 'sales_lt_customer_id',
      singular: 'sales_lt_customer_id',
      tokens: ['sales', 'lt', 'customer', 'id'],
    });
    expect(normalizeKloRelationshipName('SCREAMING_CUSTOMER_UUID')).toMatchObject({
      normalized: 'screaming_customer_uuid',
      tokens: ['screaming', 'customer', 'uuid'],
    });
    expect(normalizeKloRelationshipName('billing-account-key')).toMatchObject({
      normalized: 'billing_account_key',
      tokens: ['billing', 'account', 'key'],
    });
  });

  it('removes only leading warehouse layer prefixes', () => {
    expect(normalizeKloRelationshipName('mart__Sales_Accounts')).toMatchObject({
      normalized: 'sales_accounts',
      singular: 'sales_account',
      plural: 'sales_accounts',
      tokens: ['sales', 'accounts'],
    });
    expect(normalizeKloRelationshipName('dim_users')).toMatchObject({
      normalized: 'users',
      singular: 'user',
      plural: 'users',
      tokens: ['users'],
    });
    expect(normalizeKloRelationshipName('customer_dim_id')).toMatchObject({
      normalized: 'customer_dim_id',
      tokens: ['customer', 'dim', 'id'],
    });
  });

  it('folds accents and preserves non-suffix trailing s words', () => {
    expect(normalizeKloRelationshipName('KundénID')).toMatchObject({
      normalized: 'kunden_id',
      tokens: ['kunden', 'id'],
    });
    expect(singularizeKloRelationshipToken('address')).toBe('address');
    expect(singularizeKloRelationshipToken('addresses')).toBe('address');
    expect(singularizeKloRelationshipToken('status')).toBe('status');
    expect(pluralizeKloRelationshipToken('address')).toBe('addresses');
    expect(pluralizeKloRelationshipToken('company')).toBe('companies');
  });

  it('returns deterministic tokens for direct tokenization calls', () => {
    expect(tokenizeKloRelationshipName('HTTPResponseCode')).toEqual(['http', 'response', 'code']);
    expect(tokenizeKloRelationshipName('customer2AddressID')).toEqual(['customer', '2', 'address', 'id']);
  });

  it('scores token overlap and ordered suffix similarity', () => {
    expect(tokenSimilarity('artist_id', 'artist_id')).toBe(1);
    expect(tokenSimilarity('Album.ArtistId', 'ArtistID')).toBeGreaterThanOrEqual(0.74);
    expect(tokenSimilarity('customer_account_id', 'account_id')).toBeGreaterThan(
      tokenSimilarity('customer_account_id', 'invoice_id'),
    );
    expect(tokenSimilarity('', 'artist')).toBe(0);
  });
});
