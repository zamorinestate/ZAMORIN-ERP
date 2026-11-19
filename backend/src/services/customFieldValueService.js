'use strict';

/**
 * CUSTOM FIELD VALUE SERVICE  (Capability 26)
 *
 * Validates and normalises values written to `User.customFields` against the
 * organisation's active CustomFieldDefinition registry.
 *
 * Rules:
 *  - keys must match /^[a-z0-9_]{1,64}$/ and have an ACTIVE definition
 *  - at most 50 keys may be written in a single request
 *  - null / undefined / '' clears the value (rejected for required fields)
 *  - values are coerced to the definition's fieldType and validated
 */

const {
  CustomFieldDefinition,
} = require('../models/CustomFieldDefinition');

const { ApiError } = require('../utils/ApiError');

const MAX_CUSTOM_FIELD_KEYS = 50;
const CUSTOM_FIELD_KEY_RE = /^[a-z0-9_]{1,64}$/;
const TEXT_MAX_LENGTH = 500;
const LONG_TEXT_MAX_LENGTH = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function invalidValue(key, fieldType, detail) {
  return new ApiError(
    400,
    'INVALID_CUSTOM_FIELD_VALUE',
    `Invalid value for custom field '${key}' (${fieldType}): ${detail}`
  );
}

function normaliseTextValue(key, fieldType, rawValue, maxLength) {
  if (typeof rawValue !== 'string') {
    throw invalidValue(key, fieldType, `expected a string of at most ${maxLength} characters.`);
  }

  const value = rawValue.trim();

  if (value.length === 0) {
    return null;
  }

  if (value.length > maxLength) {
    throw invalidValue(key, fieldType, `value exceeds ${maxLength} characters.`);
  }

  return value;
}

function normaliseNumberValue(key, rawValue) {
  const value =
    typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string' && rawValue.trim() !== ''
        ? Number(rawValue.trim())
        : NaN;

  if (!Number.isFinite(value)) {
    throw invalidValue(key, 'NUMBER', 'expected a finite number.');
  }

  return value;
}

function normaliseBooleanValue(key, rawValue) {
  if (typeof rawValue === 'boolean') {
    return rawValue;
  }

  if (rawValue === 'true' || rawValue === 'false') {
    return rawValue === 'true';
  }

  throw invalidValue(key, 'BOOLEAN', 'expected true or false.');
}

function normaliseDateValue(key, rawValue) {
  if (typeof rawValue !== 'string' || !DATE_RE.test(rawValue)) {
    throw invalidValue(key, 'DATE', 'expected an ISO date in YYYY-MM-DD format.');
  }

  const parsed = new Date(`${rawValue}T00:00:00.000Z`);

  // Reject calendar overflow such as 2026-02-30.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== rawValue) {
    throw invalidValue(key, 'DATE', `'${rawValue}' is not a valid calendar date.`);
  }

  return rawValue;
}

function normaliseSelectValue(key, definition, rawValue) {
  if (typeof rawValue !== 'string') {
    throw invalidValue(key, 'SELECT', 'expected one of the allowed values.');
  }

  const value = rawValue.trim();
  const allowedValues = Array.isArray(definition.allowedValues) ? definition.allowedValues : [];

  const exact = allowedValues.find((option) => option === value);
  const canonical =
    exact ||
    allowedValues.find(
      (option) => String(option).toLowerCase() === value.toLowerCase()
    );

  if (canonical === undefined) {
    throw invalidValue(
      key,
      'SELECT',
      `'${value}' is not one of: ${allowedValues.join(', ') || '(none configured)'}.`
    );
  }

  return canonical;
}

function normaliseCustomFieldValue(definition, rawValue) {
  const key = definition.key;

  switch (definition.fieldType) {
    case 'TEXT':
      return normaliseTextValue(key, 'TEXT', rawValue, TEXT_MAX_LENGTH);
    case 'LONG_TEXT':
      return normaliseTextValue(key, 'LONG_TEXT', rawValue, LONG_TEXT_MAX_LENGTH);
    case 'NUMBER':
      return normaliseNumberValue(key, rawValue);
    case 'BOOLEAN':
      return normaliseBooleanValue(key, rawValue);
    case 'DATE':
      return normaliseDateValue(key, rawValue);
    case 'SELECT':
      return normaliseSelectValue(key, definition, rawValue);
    default:
      throw new ApiError(
        400,
        'INVALID_FIELD_TYPE',
        `Custom field '${key}' has an unsupported field type.`
      );
  }
}

/**
 * Resolve a client-supplied customFields payload into a set of writes/removals.
 *
 * @returns {Promise<{updates: Map<string, any>, removedKeys: string[]}>}
 */
async function resolveCustomFieldValues({ organisationId, values }) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new ApiError(
      400,
      'INVALID_CUSTOM_FIELD_PAYLOAD',
      'customFields must be an object keyed by custom field definition key.'
    );
  }

  const rawKeys = Object.keys(values);

  if (rawKeys.length > MAX_CUSTOM_FIELD_KEYS) {
    throw new ApiError(
      400,
      'CUSTOM_FIELD_LIMIT_REACHED',
      `At most ${MAX_CUSTOM_FIELD_KEYS} custom field keys may be written in a single request.`
    );
  }

  const updates = new Map();
  const removedKeys = [];

  if (rawKeys.length === 0) {
    return { updates, removedKeys };
  }

  const definitions = await CustomFieldDefinition.find({
    organisationId,
    status: 'ACTIVE',
  }).lean();

  const definitionsByKey = new Map(
    definitions.map((definition) => [definition.key, definition])
  );

  for (const rawKey of rawKeys) {
    const key = String(rawKey).trim().toLowerCase();

    if (!CUSTOM_FIELD_KEY_RE.test(key)) {
      throw new ApiError(
        400,
        'INVALID_CUSTOM_FIELD_KEY',
        `Custom field key '${rawKey}' must be 1-64 characters, alphanumeric and underscores only.`
      );
    }

    const definition = definitionsByKey.get(key);

    if (!definition) {
      throw new ApiError(
        400,
        'CUSTOM_FIELD_NOT_DEFINED',
        `No active custom field definition exists for key '${key}'.`
      );
    }

    const rawValue = values[rawKey];

    if (
      rawValue === null ||
      rawValue === undefined ||
      (typeof rawValue === 'string' && rawValue.trim() === '')
    ) {
      if (definition.isRequired) {
        throw new ApiError(
          400,
          'CUSTOM_FIELD_VALUE_REQUIRED',
          `Custom field '${key}' is required and cannot be cleared.`
        );
      }

      removedKeys.push(key);
      continue;
    }

    updates.set(key, normaliseCustomFieldValue(definition, rawValue));
  }

  return { updates, removedKeys };
}

module.exports = {
  MAX_CUSTOM_FIELD_KEYS,
  CUSTOM_FIELD_KEY_RE,
  normaliseCustomFieldValue,
  resolveCustomFieldValues,
};
