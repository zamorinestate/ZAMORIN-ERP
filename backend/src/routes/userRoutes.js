'use strict';

const express = require('express');

const {
  authenticate,
  requireStepUpAuthentication,
} = require('../middleware/authenticate');

const {
  authorize,
  requireReason,
} = require('../middleware/authorize');

const {
  listUsers,
  getUser,
  createUser,
  updateUser,
  updateUserCustomFields,
  changeUserStatus,
  archiveUser,
} = require('../controllers/userController');

const {
  previewRoleChange,
  executeRoleChange,
} = require('../controllers/roleGovernanceController');

const router = express.Router();

const authorizeUserAdministration =
  authorize(
    'USER:MANAGE',
    {
      allowedRoles: ['MASTER'],
      absoluteRestriction:
        'MASTER_USER_ADMINISTRATION',
      targetUserIdResolver:
        (request) =>
          request.params?.userId ||
          null,
    }
  );

const userAdministrationGuards = [
  authorizeUserAdministration,
  requireStepUpAuthentication,
  requireReason,
];

const userPreviewGuards = [
  authorizeUserAdministration,
  requireStepUpAuthentication,
];

router.use(authenticate);

router
  .route('/')
  .get(listUsers)
  .post(
    ...userAdministrationGuards,
    createUser
  );

router.post(
  '/:userId/role-impact',
  ...userPreviewGuards,
  previewRoleChange
);

router.post(
  '/:userId/role/preview',
  ...userPreviewGuards,
  previewRoleChange
);

router.patch(
  '/:userId/role',
  ...userAdministrationGuards,
  executeRoleChange
);

router.patch(
  '/:userId/status',
  ...userAdministrationGuards,
  changeUserStatus
);

router.post(
  '/:userId/archive',
  ...userAdministrationGuards,
  archiveUser
);

router.patch(
  '/:userId/custom-fields',
  ...userAdministrationGuards,
  updateUserCustomFields
);

router
  .route('/:userId')
  .get(getUser)
  .patch(
    ...userAdministrationGuards,
    updateUser
  );

module.exports = router;
