'use strict';

const {
  createDashboardI18n,
} = require('./dashboard-i18n.js');

function createTestI18n(language = 'en') {
  return createDashboardI18n({
    getLanguage: () => language,
  });
}

module.exports = {
  createTestI18n,
};
