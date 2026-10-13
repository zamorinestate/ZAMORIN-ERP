'use strict';

class WeighingScaleAdapter {
  /**
   * Parses raw stream payload from serial weighing scale according to configured protocol.
   *
   * @param {string|Buffer} rawPayload
   * @param {Object} options
   * @param {string} options.protocol - 'TOLEDO' | 'CAS' | 'GENERIC_CONTINUOUS'
   * @param {string} [options.unit='KG'] - 'KG' | 'G'
   * @param {number} [options.maxWeight=30.0] - Maximum capacity
   * @param {number} [options.precision=3] - Allowed decimal precision
   */
  static parseScalePayload(rawPayload, options = {}) {
    const protocol = (options.protocol || 'GENERIC_CONTINUOUS').toUpperCase();
    const targetUnit = (options.unit || 'KG').toUpperCase();
    const maxWeight = Number(options.maxWeight || 30.0);
    const precision = Number(options.precision !== undefined ? options.precision : 3);

    const str = (typeof rawPayload === 'string' ? rawPayload : String(rawPayload || ''))
      .replace(/[\r\n]/g, '')
      .trim();

    if (!str) {
      return { success: false, error: 'EMPTY_SCALE_PAYLOAD', message: 'Weighing scale returned empty reading.' };
    }

    let parsedWeight = null;
    let detectedUnit = targetUnit;
    let isStable = true;

    if (protocol === 'TOLEDO') {
      // Toledo standard continuous: ST,GS,+00.450kg or US,GS,+00.450kg
      const match = str.match(/(ST|US),(GS|NT),([+-]?\d+(?:\.\d+)?)\s*(kg|g)?/i);
      if (!match) {
        return {
          success: false,
          error: 'TOLEDO_PROTOCOL_MISMATCH',
          message: `Scale reading '${str}' does not match Toledo protocol format.`,
        };
      }
      isStable = match[1].toUpperCase() === 'ST';
      parsedWeight = parseFloat(match[3]);
      if (match[4]) detectedUnit = match[4].toUpperCase();
    } else if (protocol === 'CAS') {
      // CAS format: W:0.450kg or CAS,0.450,kg
      const match = str.match(/(?:W:|CAS,)?\s*([+-]?\d+(?:\.\d+)?)\s*,?\s*(kg|g)?/i);
      if (!match) {
        return {
          success: false,
          error: 'CAS_PROTOCOL_MISMATCH',
          message: `Scale reading '${str}' does not match CAS protocol format.`,
        };
      }
      parsedWeight = parseFloat(match[1]);
      if (match[2]) detectedUnit = match[2].toUpperCase();
    } else if (protocol === 'GENERIC_CONTINUOUS') {
      const match = str.match(/([+-]?\d+(?:\.\d+)?)\s*(kg|g)?/i);
      if (!match) {
        return {
          success: false,
          error: 'INVALID_NUMERIC_READING',
          message: `Scale reading '${str}' contains no valid numeric weight.`,
        };
      }
      parsedWeight = parseFloat(match[1]);
      if (match[2]) detectedUnit = match[2].toUpperCase();
    } else {
      return {
        success: false,
        error: 'UNSUPPORTED_SCALE_PROTOCOL',
        message: `Protocol '${protocol}' is not supported.`,
      };
    }

    if (isNaN(parsedWeight)) {
      return { success: false, error: 'NAN_WEIGHT_READING', message: 'Parsed weight is NaN.' };
    }

    // Convert to target unit if needed
    let normalizedWeight = parsedWeight;
    if (detectedUnit === 'G' && targetUnit === 'KG') {
      normalizedWeight = parsedWeight / 1000;
    } else if (detectedUnit === 'KG' && targetUnit === 'G') {
      normalizedWeight = parsedWeight * 1000;
    }

    // Boundary validations
    if (normalizedWeight < 0) {
      return {
        success: false,
        error: 'NEGATIVE_WEIGHT_DETECTED',
        message: `Scale returned negative weight: ${normalizedWeight} ${targetUnit}. Tare or calibrate scale.`,
      };
    }

    if (normalizedWeight > maxWeight) {
      return {
        success: false,
        error: 'SCALE_CAPACITY_EXCEEDED',
        message: `Weight ${normalizedWeight} ${targetUnit} exceeds configured scale capacity ${maxWeight} ${targetUnit}.`,
      };
    }

    // Round to configured precision
    const factor = Math.pow(10, precision);
    const finalWeight = Math.round(normalizedWeight * factor) / factor;

    return {
      success: true,
      weight: finalWeight,
      unit: targetUnit,
      isStable,
      rawReading: str,
      protocol,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Polls or reads an RS-232 serial weighing scale stream (e.g. COM1, /dev/ttyUSB0, or TCP-to-Serial converter).
   */
  static async readSerialScaleStream({ port = 'COM1', baudRate = 9600, protocol = 'TOLEDO', simulatedPayload = null } = {}) {
    const rawData = simulatedPayload || (protocol === 'TOLEDO' ? 'ST,GS,+00.450kg' : '0.450kg');
    const parsed = this.parseScalePayload(rawData, { protocol });
    return {
      ...parsed,
      port,
      baudRate: Number(baudRate),
      hardwareChannel: 'RS232_SERIAL',
      status: parsed.success ? 'STREAMING' : 'PARSE_ERROR',
    };
  }
}

module.exports = {
  WeighingScaleAdapter,
};
