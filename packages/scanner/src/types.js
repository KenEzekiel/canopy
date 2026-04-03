/**
 * @typedef {'critical' | 'high' | 'medium' | 'low'} Severity
 *
 * @typedef {Object} Finding
 * @property {string} id
 * @property {Severity} severity
 * @property {string} title
 * @property {string} file
 * @property {number} [line]
 * @property {string} description
 * @property {string} fix
 *
 * @typedef {Object} ScanSummary
 * @property {number} critical
 * @property {number} high
 * @property {number} medium
 * @property {number} low
 *
 * @typedef {Object} ScanMeta
 * @property {number} filesScanned
 * @property {number} timeMs
 *
 * @typedef {Object} ScanResult
 * @property {number} score
 * @property {ScanSummary} summary
 * @property {Finding[]} findings
 * @property {ScanMeta} meta
 */

module.exports = {};
