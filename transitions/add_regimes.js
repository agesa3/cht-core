var _ = require('underscore'),
    config = require('../config'),
    date = require('../date'),
    i18n = require('../i18n'),
    moment = require('moment'),
    utils = require('../lib/utils'),
    messages = require('../lib/messages');

module.exports = {
    filter: function(doc, req) {
        return Boolean(
            doc.form &&
            doc.patient_id &&
            doc.related_entities &&
            doc.related_entities.clinic &&
            doc.related_entities.clinic.contact &&
            doc.related_entities.clinic.contact.phone
        );
    },
    onMatch: function(change, db, callback) {
        var doc = change.doc,
            successful = [],
            regimes = config.get('task_regimes'),
            updated;

        updated = _.any(regimes, function(regime) {
            return module.exports.addRegime(doc, regime);
        });

        callback(null, updated);
    },
    getOffset: function(offset) {
        var tokens = (offset || '').split(' '),
            value = tokens[0],
            unit = tokens[1];

        if (/\d+/.test(value) && /(second|minute|hour|day|week|month|year)s?/.test(unit)) {
            return moment.duration(Number(value), unit);
        } else {
            return false;
        }
    },
    getNextTimes: function(doc, now) {
        var due = _.first(doc.scheduled_tasks).due,
            times = {};

        if (due && now) {
            _.each(['minutes', 'hours', 'days', 'weeks', 'months', 'years'], function(unit) {
                times[unit] = now.diff(due, unit);
            });
        } else {
            return {};
        }
    },
    alreadyRun: function(doc, type) {
        var scheduled_task,
            task;

        scheduled_task = _.findWhere(doc.scheduled_tasks, {
            type: type
        });
        task = _.findWhere(doc.tasks, {
            type: type
        });
        return Boolean(scheduled_task || task);
    },
    formMismatch: function(form, doc) {
        return doc.form !== form;
    },
    addRegime: function(doc, regime) {
        var docStart,
            start,
            clinic_contact_name = utils.getClinicContactName(doc),
            clinic_name = utils.getClinicName(doc),
            clinic_phone = utils.getClinicPhone(doc),
            now = moment(date.getDate()),
            times;

        // if we  can't find the regime in config, we're done
        // also if forms mismatch or already run
        if (!_.isObject(regime) || module.exports.formMismatch(regime.form, doc) || module.exports.alreadyRun(doc, regime.key)) {
            return false;
        }

        docStart = doc[regime.start_from];

        // if the document does not have the `start_from` property (or its falsey) do nothing; this
        // will be rerun on next document change
        if (!docStart) {
            return false;
        }

        start = moment(docStart);

        _.each(regime.messages, function(msg) {
            var due,
                offset = module.exports.getOffset(msg.offset);

            if (offset) {
                due = start.clone().add(offset).toISOString();
                messages.scheduleMessage(doc, {
                    due: due,
                    message: msg.message,
                    group: msg.group,
                    type: regime.key
                });
            } else {
                // bad offset, skip this msg
                console.log("%s cannot be parsed as a valid offset. Skipping this msg of %s regime.", msg.offset, regime.key);
            }
        });

        // send response if configured
        if (doc.scheduled_tasks && regime.registration_response) {
            times = module.exports.getNextTimes(doc, now);
            messages.addReply(doc, regime.registration_response, times);
        }

        // why does this signify a successful addRegime shouldn't we check doc?
        // if more than zero messages added, return true
        return !!regime.messages.length;

    },
    repeatable: true
};
