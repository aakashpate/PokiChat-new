const router = require('express').Router();
const { searchUsers, getPresence } = require('../controllers/userController');
const { requireAuth, loadUser } = require('../middleware/auth');

router.use(requireAuth, loadUser);

router.get('/users/search', searchUsers);
router.get('/users/presence', getPresence);

module.exports = router;
