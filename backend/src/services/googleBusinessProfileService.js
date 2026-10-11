'use strict';

/**
 * GOOGLE BUSINESS PROFILE SERVICE (BENCHMARK A005 & A006)
 *
 * Implements:
 *   - A005: Multi-location Google Business Profile management, location syncing & performance insights
 *   - A006: Google customer reviews fetching, sentiment aggregation, and authoritative reply management
 */

const { GoogleBusinessProfile } = require('../models/GoogleBusinessProfile');
const { ApiError } = require('../utils/ApiError');

/**
 * Connect or update GBP profile for an outlet
 */
async function upsertProfileConnection({
  organisationId,
  cafeId,
  locationId,
  displayName,
  accountName = '',
  primaryPhone = '',
  addressLine = '',
}) {
  if (!organisationId || !cafeId || !locationId || !displayName) {
    throw new ApiError(400, 'MISSING_GBP_FIELDS', 'organisationId, cafeId, locationId, and displayName are required.');
  }

  const profile = await GoogleBusinessProfile.findOneAndUpdate(
    { organisationId, cafeId },
    {
      $set: {
        locationId,
        displayName,
        accountName,
        primaryPhone,
        addressLine,
        syncStatus: 'CONNECTED',
        lastSyncedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  return {
    success: true,
    profile: profile.toObject(),
  };
}

/**
 * Record performance insights (Search, Maps views, calls, directions)
 */
async function recordInsightsMetrics({ organisationId, cafeId, metrics = {} }) {
  const profile = await GoogleBusinessProfile.findOne({ organisationId, cafeId });
  if (!profile) {
    throw new ApiError(404, 'GBP_PROFILE_NOT_FOUND', `GBP profile for cafe ${cafeId} not found.`);
  }

  profile.metrics = {
    viewsSearch: Number(metrics.viewsSearch ?? profile.metrics.viewsSearch ?? 0),
    viewsMaps: Number(metrics.viewsMaps ?? profile.metrics.viewsMaps ?? 0),
    actionsWebsite: Number(metrics.actionsWebsite ?? profile.metrics.actionsWebsite ?? 0),
    actionsCalls: Number(metrics.actionsCalls ?? profile.metrics.actionsCalls ?? 0),
    actionsDrivingDirections: Number(metrics.actionsDrivingDirections ?? profile.metrics.actionsDrivingDirections ?? 0),
  };
  profile.lastSyncedAt = new Date();
  await profile.save();

  return {
    success: true,
    metrics: profile.metrics,
  };
}

/**
 * Ingest or sync Google Reviews for the outlet
 */
async function syncReviews({ organisationId, cafeId, reviews = [] }) {
  const profile = await GoogleBusinessProfile.findOne({ organisationId, cafeId });
  if (!profile) {
    throw new ApiError(404, 'GBP_PROFILE_NOT_FOUND', `GBP profile for cafe ${cafeId} not found.`);
  }

  const existingMap = new Map((profile.reviews || []).map((r) => [r.reviewId, r]));

  for (const r of reviews) {
    if (!r.reviewId || !r.starRating) continue;
    const existing = existingMap.get(r.reviewId);
    if (existing) {
      existing.reviewerName = r.reviewerName || existing.reviewerName;
      existing.starRating = r.starRating;
      existing.comment = r.comment !== undefined ? r.comment : existing.comment;
      if (r.reply) existing.reply = r.reply;
    } else {
      existingMap.set(r.reviewId, {
        reviewId: r.reviewId,
        reviewerName: r.reviewerName || 'Anonymous',
        starRating: r.starRating,
        comment: r.comment || '',
        reviewDate: r.reviewDate ? new Date(r.reviewDate) : new Date(),
        reply: r.reply || null,
      });
    }
  }

  profile.reviews = Array.from(existingMap.values());
  profile.lastSyncedAt = new Date();
  await profile.save();

  return {
    success: true,
    totalReviews: profile.reviews.length,
    reviews: profile.reviews,
  };
}

/**
 * Submit an authoritative owner/manager reply to a Google Review
 */
async function replyToReview({ organisationId, cafeId, reviewId, comment, repliedByUserId }) {
  if (!comment || !repliedByUserId) {
    throw new ApiError(400, 'INVALID_REPLY_DATA', 'Reply comment and repliedByUserId are required.');
  }

  const profile = await GoogleBusinessProfile.findOne({ organisationId, cafeId });
  if (!profile) {
    throw new ApiError(404, 'GBP_PROFILE_NOT_FOUND', `GBP profile for cafe ${cafeId} not found.`);
  }

  const targetReview = (profile.reviews || []).find((r) => r.reviewId === reviewId);
  if (!targetReview) {
    throw new ApiError(404, 'REVIEW_NOT_FOUND', `Review ${reviewId} not found.`);
  }

  targetReview.reply = {
    comment: comment.trim(),
    repliedAt: new Date(),
    repliedByUserId,
  };

  await profile.save();

  return {
    success: true,
    reviewId,
    reply: targetReview.reply,
  };
}

/**
 * Get profile status, performance insights and review aggregate rating
 */
async function getProfileSummary({ organisationId, cafeId }) {
  const profile = await GoogleBusinessProfile.findOne({ organisationId, cafeId }).lean();
  if (!profile) {
    return {
      connected: false,
      profile: null,
      averageRating: 0,
      totalReviews: 0,
    };
  }

  const reviews = profile.reviews || [];
  const totalReviews = reviews.length;
  const sumRatings = reviews.reduce((sum, r) => sum + (r.starRating || 0), 0);
  const averageRating = totalReviews > 0 ? Number((sumRatings / totalReviews).toFixed(2)) : 0;

  return {
    connected: profile.syncStatus === 'CONNECTED',
    profile,
    averageRating,
    totalReviews,
    metrics: profile.metrics,
  };
}

module.exports = {
  upsertProfileConnection,
  recordInsightsMetrics,
  syncReviews,
  replyToReview,
  getProfileSummary,
};
