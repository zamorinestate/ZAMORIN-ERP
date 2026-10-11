'use strict';

/**
 * TASK LOCATION SERVICE
 * Geofencing & GPS proof validation using Haversine spherical distance calculation.
 */

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates great-circle distance between two GPS coordinates in meters.
 */
function calculateHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  if (
    typeof lat1 !== 'number' ||
    typeof lon1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lon2 !== 'number' ||
    Number.isNaN(lat1) ||
    Number.isNaN(lon1) ||
    Number.isNaN(lat2) ||
    Number.isNaN(lon2)
  ) {
    return null;
  }

  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Validates whether submitted GPS coordinates fall within allowed geofence radius.
 * @param {Object} submittedLocation - { latitude, longitude, accuracyMeters }
 * @param {Object} targetGeofence - { latitude, longitude, radiusMeters }
 * @returns {Object} { isVerified, distanceMeters, status, message }
 */
function validateLocationProof(submittedLocation, targetGeofence) {
  if (!targetGeofence || targetGeofence.latitude == null || targetGeofence.longitude == null) {
    // No target location configured: location check is not restrictive
    return {
      isVerified: true,
      distanceMeters: 0,
      status: 'NOT_REQUIRED',
      message: 'No geofence requirement configured for this task.',
    };
  }

  if (!submittedLocation || submittedLocation.latitude == null || submittedLocation.longitude == null) {
    return {
      isVerified: false,
      distanceMeters: null,
      status: 'MISSING_COORDINATES',
      message: 'GPS location proof is required but device coordinates were not provided.',
    };
  }

  const radius = targetGeofence.radiusMeters || 200;
  const distance = calculateHaversineDistanceMeters(
    targetGeofence.latitude,
    targetGeofence.longitude,
    submittedLocation.latitude,
    submittedLocation.longitude
  );

  if (distance == null) {
    return {
      isVerified: false,
      distanceMeters: null,
      status: 'INVALID_COORDINATES',
      message: 'Coordinates could not be evaluated.',
    };
  }

  const isInside = distance <= radius;

  return {
    isVerified: isInside,
    distanceMeters: distance,
    allowedRadiusMeters: radius,
    status: isInside ? 'VERIFIED_IN_RANGE' : 'OUT_OF_RANGE',
    message: isInside
      ? `Location verified: within ${distance}m of site (limit: ${radius}m).`
      : `Location proof failed: ${distance}m from site exceeds allowed radius of ${radius}m.`,
  };
}

module.exports = {
  calculateHaversineDistanceMeters,
  validateLocationProof,
};
