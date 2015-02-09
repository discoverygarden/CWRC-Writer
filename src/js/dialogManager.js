define([
  'jquery',
  'jquery-ui',
  'cwrcDialogs',
  'dialogs/addSchema', 'dialogs/fileManager', 'dialogs/header', 'dialogs/message', 'dialogs/triple',
  'dialogs/cwrcPerson', 'dialogs/cwrcOrg', 'dialogs/cwrcPlace', 'dialogs/cwrcTitle', 'dialogs/cwrcCitation'
], function ($, jqueryui, CwrcDialog,
             AddSchema, FileManager, Header, Message, Triple,
             CwrcPerson, CwrcOrg, CwrcPlace, CwrcTitle, CwrcCitation) {
  'use strict';
  // Add event listeners to all of our jquery-ui dialogs.
  $.extend($.ui.dialog.prototype.options, {
    create: function (event) {
      $(event.target).on('dialogopen', function (event) {
        // wrap our dialogs in the cwrc css scope
        $(event.target).parent('.ui-dialog').prev('.ui-widget-overlay').andSelf().wrapAll('<div class="cwrc" />');
        // resize if necessary
        var docHeight = $(document).height();
        if ($(this).dialog('option', 'height') >= docHeight) {
          $(this).dialog('option', 'height', docHeight * 0.85);
        }
      }).on('dialogclose', function (event) {
        $(event.target).parent('.ui-dialog').unwrap();
      });
    }
  });
  // Do the same for tooltips.
  $.extend($.ui.tooltip.prototype.options, {
    create: function (event) {
      $(event.target).on('tooltipopen', function (event, ui) {
        $(ui.tooltip).wrap('<div class="cwrc" />');
      }).on('tooltipclose', function (event, ui) {
        $(ui.tooltip).unwrap();
      });
    }
  });

  /**
   * @class DialogManager
   * @param {Writer} writer
   */
  return function (writer) {
    var w = writer,
      cD = new CwrcDialog(writer);

    // log in for CWRC-Dialogs
    cD.initializeWithCookieData(null);
    var dialogs = {
      message: new Message(w),
      triple: new Triple(w),
      header: new Header(w),
      filemanager: new FileManager(w),
      addschema: new AddSchema(w),
      person: new CwrcPerson(w, cD),
      org: new CwrcOrg(w, cD),
      title: new CwrcTitle(w, cD),
      citation: new CwrcCitation(w, cD),
      place: new CwrcPlace(w, cD)
    };

    if (w.initialConfig.cwrcDialogs != null) {
      var conf = w.initialConfig.cwrcDialogs;
      if (conf.cwrcApiUrl != null) cD.setCwrcApi(conf.cwrcApiUrl);
      if (conf.geonameUrl != null) cD.setGeonameUrl(conf.geonameUrl);
      if (conf.viafUrl != null) cD.setViafUrl(conf.viafUrl);
    }

    var schemaDialogs = {};
    var dialogNames = ['citation', 'correction', 'date', 'keyword', 'link', 'note', 'org', 'person', 'place', 'title'];

    var loadSchemaDialogs = function(schemaId) {
      // get root element
      var schemaDialogId;
      var schemaXML = w.schemaManager.schemaXML;
      var startEl = $('start element:first', schemaXML).attr('name');
      if (!startEl) {
        var startName = $('start ref:first', schemaXML).attr('name');
        startEl = $('define[name="'+startName+'"] element', schemaXML).attr('name');
      }
      if (schemaId === 'tei' || startEl === 'TEI') {
        schemaDialogId = 'tei';
        // TODO destroy previously loaded dialogs
        if (schemaDialogs[schemaDialogId] == null) {
          var parent = schemaDialogs[schemaDialogId] = {};
          var schemaDialogNames = [];
          schemaDialogNames = $.map(dialogNames, function(name, i) {
            return 'dialogs/schemas/'+schemaDialogId+'/'+name;
          });
          require(schemaDialogNames, function() {
            if (arguments.length != schemaDialogNames.length) {
              alert('error loading schema dialogs');
            } else {
              for (var i = 0; i < arguments.length; i++) {
                var name = dialogNames[i];
                parent[name] = new arguments[i](w);
              }
            }
          });
        }
      } else {
        w.dialogManager.show('message', {
          title: 'Error',
          msg: 'This schema doesn\'t have full dialog support yet!',
          type: 'error'
        });
      }
    };

    w.event('schemaLoaded').subscribe(function() {
      loadSchemaDialogs(w.schemaManager.schemaId);
    });

    /**
     * @lends DialogManager.prototype
     */
    var pm = {
      show: function(type, config) {
        if (type.indexOf('schema/') === 0) {
          var typeParts = type.split('/');
          var type = typeParts[1];
          schemaDialogs[w.schemaManager.schemaId][type].show(config);
        } else {
          if (dialogs[type]) {
            dialogs[type].show(config);
          } else if (schemaDialogs[w.schemaManager.schemaId][type]) {
            schemaDialogs[w.schemaManager.schemaId][type].show(config);
          }
        }
      },
      confirm: function(config) {
        dialogs.message.confirm(config);
      }
    };

    $.extend(pm, dialogs);

    return pm;
  };

});
