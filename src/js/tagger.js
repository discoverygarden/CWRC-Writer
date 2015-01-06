define(['jquery'], function($) {

/**
 * @class Tagger
 * @param {Writer} writer
 */
return function(writer) {
	var w = writer;
	
	/**
	 * @lends Tagger.prototype
	 */
	var tagger = {};
	
	/**
	 * Inserts entity boundary tags around the supplied DOM range.
	 * @param {string} id The id of then entity 
	 * @param {string} type The entity type
	 * @param {range} range The DOM range to insert the tags around
	 */
	tagger.insertBoundaryTags = function(id, type, range) {
		var parentTag = w.entitiesModel.getParentTag(type, w.schemaManager.schemaId);
		
		if (type === 'note' || type === 'citation' || type === 'keyword') {
			var tag = w.editor.dom.create('span', {
				'_entity': true, '_note': true, '_tag': parentTag, '_type': type, 'class': 'entity '+type+' start', 'name': id, 'id': id
			}, '');
			var sel = w.editor.selection;
			sel.setRng(range);
			if (tinymce.isWebKit) {
				// chrome seems to mess up the range slightly if not set again
				sel.setRng(range);
			}
			sel.collapse(false);
			range = sel.getRng(true);
			range.insertNode(tag);
			
			w.editor.dom.bind(tag, 'click', function(e) {
				var marker = w.editor.dom.get(e.target);
				var tagId = marker.getAttribute('name');
				tagger.editTag(tagId);
			});
		} else {
			if (range.startContainer.parentNode != range.endContainer.parentNode) {
				var nodes = w.utilities.getNodesInBetween(range.startContainer, range.endContainer);
				
				var startRange = range.cloneRange();
				startRange.setEnd(range.startContainer, range.startContainer.length);
				var start = w.editor.dom.create('span', {
					'_entity': true, '_type': type, 'class': 'entity '+type+' start', 'name': id
				}, '');
				startRange.surroundContents(start);
				
				$.each(nodes, function(index, node) {
					$(node).wrap('<span _entity="true" _type="'+type+'" class="entity '+type+'" name="'+id+'" />');
				});
				
				var endRange = range.cloneRange();
				endRange.setStart(range.endContainer, 0);
				var end = w.editor.dom.create('span',{
					'_entity': true, '_type': type, 'class': 'entity '+type+' end', 'name': id
				}, '');
				endRange.surroundContents(end);
			} else {
				var start = w.editor.dom.create('span', {
					'_entity': true, '_tag': parentTag, '_type': type, 'class': 'entity '+type+' start end', 'name': id, 'id': id
				}, '');
				range.surroundContents(start);
			}
		}
	};
	
	// prevents the user from moving the caret inside a marker
	var _doMarkerClick = function(e) {
		var marker = w.editor.dom.get(e.target);
		var range = w.editor.selection.getRng(true);
		if (w.editor.dom.hasClass(marker, 'start')) {
			range.setStartAfter(marker);
			range.setEndAfter(marker);
		} else {
			range.setStartBefore(marker);
			range.setEndBefore(marker);
		}
		w.editor.selection.setRng(range);
		w.highlightEntity(marker.getAttribute('name'), w.editor.selection.getBookmark());
	};
	
	/**
	 * Get the entity boundary tag that corresponds to the passed tag.
	 * @param {element} tag
	 */
	tagger.getCorrespondingEntityTag = function(tag) {
		tag = $(tag);
		var corrTag;
		if (tag.hasClass('start')) {
			corrTag = tagger.findEntityBoundary('end', tag[0].nextSibling);
		} else {
			corrTag = tagger.findEntityBoundary('start', tag[0].previousSibling);
		}
		return corrTag;
	};
	
	/**
	 * Searches for an entity boundary containing the current node.
	 * @param {string} boundaryType Either 'start' or 'end'.
	 * @param {element} currentNode The node that is currently being examined.
	 */
	tagger.findEntityBoundary = function(boundaryType, currentNode) {
		
		/**
		 * @param entIds An array of entity ids that are encountered.  Used to prevent false positives.
		 * @param levels An array to track the levels of node depth in order to prevent endless recursion.
		 * @param structIds An object to track the node ids that we've already encountered.
		 */
		function doFind(boundaryType, currentNode, entIds, levels, structIds) {
			if (currentNode.id) {
				if (structIds[currentNode.id]) {
					return null;
				} else {
					structIds[currentNode.id] = true;
				}
			}
			
			if (w.editor.dom.hasClass(currentNode, 'entity')) {
				var nodeId = currentNode.getAttribute('name');
				if (w.editor.dom.hasClass(currentNode, boundaryType)) {
					if (entIds.indexOf(nodeId) == -1) {
						return currentNode;
					} else if (entIds[0] == nodeId) {
						entIds.shift();
					}
				} else {
					entIds.push(nodeId);
				}
			}
			
			if (boundaryType == 'start' && currentNode.lastChild) {
				levels.push(currentNode);
				return doFind(boundaryType, currentNode.lastChild, entIds, levels, structIds);
			} else if (boundaryType == 'end' && currentNode.firstChild) {
				levels.push(currentNode);
				return doFind(boundaryType, currentNode.firstChild, entIds, levels, structIds);
			}
			
			if (boundaryType == 'start' && currentNode.previousSibling) {
				return doFind(boundaryType, currentNode.previousSibling, entIds, levels, structIds);
			} else if (boundaryType == 'end' && currentNode.nextSibling) {
				return doFind(boundaryType, currentNode.nextSibling, entIds, levels, structIds);
			}
			
			if (currentNode.parentNode) {
				if (currentNode.parentNode == levels[levels.length-1]) {
					levels.pop();
					if (boundaryType == 'start' && currentNode.parentNode.previousSibling) {
						return doFind(boundaryType, currentNode.parentNode.previousSibling, entIds, levels, structIds);
					} else if (boundaryType == 'end' && currentNode.parentNode.nextSibling) {
						return doFind(boundaryType, currentNode.parentNode.nextSibling, entIds, levels, structIds);
					} else return null;
				} else {
					return doFind(boundaryType, currentNode.parentNode, entIds, levels, structIds);
				}
			}
			
			return null;
		};
		
		var match = doFind(boundaryType, currentNode, [], [currentNode.parentNode], {});
		return match;
	};
	
	/**
	 * Looks for tags that have been added or deleted and updates the entity and struct lists.
	 * Returns true if a new tag is found.
	 * @returns {Boolean}
	 */
	tagger.findNewAndDeletedTags = function() {
		var updateRequired = false;
		
		// new tags
		var newTags = w.editor.dom.select('[_tag]:not([id])');
		if (newTags.length > 0) updateRequired = true;
		
		// deleted tags
		for (var id in w.entities) {
			var nodes = w.editor.dom.select('[name="'+id+'"]');
			if (nodes.length === 0) {
				updateRequired = true;
				w.deletedEntities[id] = w.entities[id];
				delete w.entities[id];
				w.event('entityRemoved').publish(id);
				break;
			}
		}
		for (var id in w.structs) {
			var nodes = w.editor.dom.select('#'+id);
			if (nodes.length === 0) {
				updateRequired = true;
				w.deletedStructs[id] = w.structs[id];
				delete w.structs[id];
			}
		}
		return updateRequired;
	};
	
	/**
	 * Looks for duplicate tags (from copy paste operations) and creates new entity/struct entries.
	 */
	tagger.findDuplicateTags = function() {
		for (var id in w.entities) {
			var match = $('span[class~="start"][name="'+id+'"]', w.editor.getBody());
			if (match.length > 1) {
				match.each(function(index, el) {
					if (index > 0) {
						var newId = tinymce.DOM.uniqueId('ent_');
						var newTagStart = $(el);
						var newTagEnd = $(tagger.getCorrespondingEntityTag(newTagStart));
						newTagStart.attr('name', newId);
						newTagEnd.attr('name', newId);

						var newEntity = jQuery.extend(true, {}, w.entities[id]);
						newEntity.props.id = newId;
						w.entities[newId] = newEntity;
					}
				});
			}
		}
		for (var id in w.structs) {
			var match = $('*[id='+id+']', w.editor.getBody());
			if (match.length == 2) {
				var newStruct = match.last();
				var newId = tinymce.DOM.uniqueId('struct_');
				newStruct.attr('id', newId);
				w.structs[newId] = {};
				for (var key in w.structs[id]) {
					w.structs[newId][key] = w.structs[id][key];
				}
				w.structs[newId].id = newId;
			}
		}
	};
	
	tagger.getCurrentTag = function(id) {
		var tag = {entity: null, struct: null};
		if (id != null) {
			if (w.entities[id]) tag.entity = w.entities[id];
			else if (w.structs[id]) tag.struct = $('#'+id, w.editor.getBody());
		} else {
			if (w.editor.currentEntity != null) tag.entity = w.entities[w.editor.currentEntity];
			else if (w.editor.currentStruct != null) tag.struct = $('#'+w.editor.currentStruct, w.editor.getBody());
		}
		return tag;
	};
	
	// a general edit function for entities and structure tags
	tagger.editTag = function(id, pos) {
		var tag = tagger.getCurrentTag(id);
		if (tag.entity) {
			w.editor.currentBookmark = w.editor.selection.getBookmark(1);
			var type = tag.entity.props.type;
			w.dialogManager.show(type, {type: type, title: w.entitiesModel.getTitle(type), pos: pos, entry: tag.entity});
		} else if (tag.struct) {
			if ($(tag.struct, w.editor.getBody()).attr('_tag')) {
				w.editor.execCommand('editSchemaTag', tag.struct, pos);
			} else {
				alert('Tag not recognized!');
			}
		}
	};
	
	// a general change/replace function
	tagger.changeTag = function(params) {
		var tag = tagger.getCurrentTag(params.id);
		if (tag.entity) {
		} else if (tag.struct) {
			if ($(tag.struct, w.editor.getBody()).attr('_tag')) {
				w.editor.execCommand('changeSchemaTag', {tag: tag.struct, pos: params.pos, key: params.key});
			}
		} 
	};
	
	/**
	 * A general removal function for entities and structure tags
	 * @param {String} id The id of the tag to remove
	 */
	tagger.removeTag = function(id) {
		if (id != null) {
			if (w.entities[id]) {
				tagger.removeEntity(id);
			} else if (w.structs[id]) {
				tagger.removeStructureTag(id);
			}
		} else {
			if (w.editor.currentEntity != null) {
				tagger.removeEntity(w.editor.currentEntity);
			} else if (w.editor.currentStruct != null) {
				tagger.removeStructureTag(w.editor.currentStruct);
			}
		}
	};
	
	
	/**
	 * Add our own undo level, then erase the next one that gets added by tinymce
	 */
	function _doCustomTaggerUndo() {
		// TODO update for 4
		w.editor.undoManager.add();
		w.editor.undoManager.onAdd.addToTop(function() {
			this.data.splice(this.data.length-1, 1); // remove last undo level
			this.onAdd.listeners.splice(0, 1); // remove this listener
		}, w.editor.undoManager);
	}
	
	/**
	 * Displays the appropriate dialog for adding an entity
	 * @param {String} type The entity type
	 */
	tagger.addEntity = function(type) {
		var result = w.utilities.isSelectionValid();
		if (result === w.VALID || result === w.NO_COMMON_PARENT) {
			w.editor.currentBookmark = w.editor.selection.getBookmark(1);
			w.dialogManager.show(type, {type: type, title: w.entitiesModel.getTitle(type), pos: w.editor.contextMenuPos});
		} else if (result === w.NO_SELECTION) {
			w.dialogManager.show('message', {
				title: 'Error',
				msg: 'Please select some text before adding an entity.',
				type: 'error'
			});
//		} else if (result === w.NO_COMMON_PARENT) {
//			w.dialogManager.show('message', {
//				title: 'Error',
//				msg: 'Please ensure that the beginning and end of your selection have a common parent.<br/>For example, your selection cannot begin in one paragraph and end in another, or begin in bolded text and end outside of that text.',
//				type: 'error'
//			});
		} else if (result === w.OVERLAP) {
			if (w.allowOverlap === false) {
				w.dialogManager.show('message', {
					title: 'Error',
					msg: 'You are trying to insert an overlapping entity, however the current Editor Mode doesn\'t allow overlapping. Go to Settings to change it.',
					type: 'error'
				});
			} else {
				w.dialogManager.confirm({
					title: 'Info',
					msg: 'This annotation overlaps with other tags, so an XML tag for this annotation cannot be inserted in the document. The editor will create a stand-off semantic web annotation only.<br/>If you wish to insert an XML tag, select a portion of the text to annotate that does not overlap other XML tags.<br/>Do you still wish to insert this annotation?',
					callback: function(confirmed) {
						if (confirmed) {
							w.editor.currentBookmark = w.editor.selection.getBookmark(1);
							w.dialogManager.show(type, {type: type, title: w.entitiesModel.getTitle(type), pos: w.editor.contextMenuPos});
						}
					}
				});
			}
		}
	};
	
	/**
	 * Add the remaining entity info to its entry
	 * @protected
	 * @fires Writer#entityAdded
	 * @param {String} type Then entity type
	 * @param {Object} info The entity info
	 */
	tagger.finalizeEntity = function(type, info) {
		w.editor.selection.moveToBookmark(w.editor.currentBookmark);
		if (info != null) {
			var id = tagger.addEntityTag(type);
			
			// add attributes to tag
			if (info.attributes) {
				var tag = w.editor.$('[name='+id+'][_tag]');
				if (tag.length === 1) {
					var tagName = tag.attr('_tag');
					for (var key in info.attributes[tagName]) {
						var val = info.attributes[tagName][key];
						tag.attr(key, w.utilities.escapeHTMLString(val));
					}
				}
			}
			
			var entry = w.entities[id];
			entry.info = info;
			if (type === 'note' || type === 'citation') {
				var content = $($.parseXML(entry.info.content)).text();
				entry.props.title = w.utilities.getTitleFromContent(content);
			} else if (type === 'keyword') {
				var content = entry.info.keywords.join(', ');
				entry.props.title = w.utilities.getTitleFromContent(content);
			}
			
			$.when(
				w.delegator.getUriForEntity(entry),
				w.delegator.getUriForAnnotation(),
				w.delegator.getUriForDocument(),
				w.delegator.getUriForTarget(),
				w.delegator.getUriForSelector(),
				w.delegator.getUriForUser()
			).then(function(entityUri, annoUri, docUri, targetUri, selectorUri, userUri) {
				if (info.cwrcInfo && info.cwrcInfo.id) {
					// use the id already provided
					entityUri = info.cwrcInfo.id;
				}
				entry.annotation = {
					entityId: entityUri,
					annotationId: annoUri,
					docId: docUri,
					targetId: targetUri,
					selectorId: selectorUri,
					userId: userUri,
					range: {}
				};
				
				w.event('entityAdded').publish(id);
			});
		}
		w.editor.currentBookmark = null;
		w.editor.focus();
	};
	
	/**
	 * Update the entity info
	 * @fires Writer#entityEdited
	 * @param {String} id The entity id
	 * @param {Object} info The entity info
	 */
	tagger.editEntity = function(id, info) {
		w.entities[id].info = info;
		w.event('entityEdited').publish(id);
	};
	
	/**
	 * Copy an entity internally
	 * @fires Writer#entityCopied
	 * @param {String} id The entity id
	 */
	tagger.copyEntity = function(id) {
		var tag = tagger.getCurrentTag(id);
		if (tag.entity) {
			w.editor.entityCopy = tag.entity;
			w.event('entityCopied').publish(id);
		} else {
			w.dialogManager.show('message', {
				title: 'Error',
				msg: 'Cannot copy structural tags.',
				type: 'error'
			});
		}
	};
	
	/**
	 * Paste a previously copied entity
	 * @fires Writer#entityPasted
	 */
	tagger.pasteEntity = function() {
		if (w.editor.entityCopy == null) {
			w.dialogManager.show('message', {
				title: 'Error',
				msg: 'No entity to copy!',
				type: 'error'
			});
		} else {
			var newEntity = jQuery.extend(true, {}, w.editor.entityCopy);
			newEntity.props.id = tinymce.DOM.uniqueId('ent_');
			
			w.editor.selection.moveToBookmark(w.editor.currentBookmark);
			var sel = w.editor.selection;
			sel.collapse();
			var rng = sel.getRng(true);
			
			var type = newEntity.props.type;
			var content;
			if (type === 'note' || type === 'citation' || type === 'keyword') {
				content = '\uFEFF';
			} else {
				content = newEntity.props.content;
			}
			
			var text = w.editor.getDoc().createTextNode(content);
			rng.insertNode(text);
			sel.select(text);
			
			rng = sel.getRng(true);
			tagger.insertBoundaryTags(newEntity.props.id, newEntity.props.type, rng);
			
			w.entities[newEntity.props.id] = newEntity;
			
			w.event('entityPasted').publish(newEntity.props.id);
		}
	};
	
	/**
	 * Remove an entity
	 * @fires Writer#entityRemoved
	 * @param {String} id The entity id
	 */
	tagger.removeEntity = function(id) {
		id = id || w.editor.currentEntity;
		
		delete w.entities[id];
		var node = $('span[name="'+id+'"]', w.editor.getBody());
		var parent = node[0].parentNode;
		node.remove();
		parent.normalize();
		
		w.event('entityRemoved').publish(id);
		
		w.editor.currentEntity = null;
	};
	
	tagger.addEntityTag = function(type) {
		_doCustomTaggerUndo();
		
		var sel = w.editor.selection;
		var content = sel.getContent();
		var range = sel.getRng(true);
		
		// strip tags
		content = content.replace(/<\/?[^>]+>/gi, '');
		
		// trim whitespace
		if (range.startContainer == range.endContainer) {
			var leftTrimAmount = content.match(/^\s{0,1}/)[0].length;
			var rightTrimAmount = content.match(/\s{0,1}$/)[0].length;
			range.setStart(range.startContainer, range.startOffset+leftTrimAmount);
			range.setEnd(range.endContainer, range.endOffset-rightTrimAmount);
			sel.setRng(range);
			content = content.replace(/^\s+|\s+$/g, '');
		}
		
		var title = w.utilities.getTitleFromContent(content);
		var id = tinymce.DOM.uniqueId('ent_');
		w.entities[id] = {
			props: {
				id: id,
				type: type,
				title: title,
				content: content
			},
			info: {}
		};
		
		if (content != '') {
			tagger.insertBoundaryTags(id, type, range);
		} else {
			w.emptyTagId = id;
		}
		
		return id;
	};
	
	/**
	 * Adds a structure tag to the document, based on the params.
	 * @fires Writer#tagAdded
	 * @param params An object with the following properties:
	 * @param params.bookmark A tinymce bookmark object, with an optional custom tagId property
	 * @param params.attributes Various properties related to the tag
	 * @param params.action Where to insert the tag, relative to the bookmark (before, after, around, inside); can also be null
	 */
	tagger.addStructureTag = function(params) {
		_doCustomTaggerUndo();
		
		var bookmark = params.bookmark;
		var attributes = params.attributes;
		var action = params.action;
		
		var id = (attributes['xml:id'] !== undefined) ? attributes['xml:id'] : tinymce.DOM.uniqueId('struct_');
		attributes.id = id;
		attributes._textallowed = w.utilities.canTagContainText(attributes._tag);
		w.structs[id] = attributes;
		w.editor.currentStruct = id;
		
		var node;
		if (bookmark.tagId) {
			// this is used when adding tags through the structure tree
			node = $('#'+bookmark.tagId, w.editor.getBody())[0];
		} else {
			// this is meant for user text selections
			node = bookmark.rng.commonAncestorContainer;
			while (node.nodeType == 3 || (node.nodeType == 1 && !node.hasAttribute('_tag'))) {
				node = node.parentNode;
			}
		}
		
		var tagName = w.utilities.getTagForEditor(attributes._tag);
		var open_tag = '<'+tagName;
		for (var key in attributes) {
			if (key == 'id' || key.match(/^_/) != null) {
				open_tag += ' '+key+'="'+attributes[key]+'"';
			} 
		}
		// TODO find a better way of handling this
		if (attributes._tag == 'title') {
			if (attributes.level != null) {
				open_tag += ' level="'+attributes.level+'"';
			}
			if (attributes.type != null) {
				open_tag += ' type="'+attributes.type+'"';
			}
		}
		
		open_tag += '>';
		var close_tag = '</'+tagName+'>';
		
		var selection = '\uFEFF';
		var content = open_tag + selection + close_tag;
		if (action == 'before') {
			$(node).before(content);
		} else if (action == 'after') {
			$(node).after(content);
		} else if (action == 'around') {
			$(node).wrap(content);
		} else if (action == 'inside') {
			$(node).wrapInner(content);
		} else {
			w.editor.selection.moveToBookmark(bookmark);
			selection = w.editor.selection.getContent();
			if (selection == '') selection = '\uFEFF';
			content = open_tag + selection + close_tag;

			var range = w.editor.selection.getRng(true);
			var tempNode = $('<span data-mce-bogus="1">', w.editor.getDoc());
			range.surroundContents(tempNode[0]);
			tempNode.replaceWith(content);
		}
		
		w.event('tagAdded').publish(id);
		
		if (selection == '\uFEFF') {
			w.selectStructureTag(id, true);
		} else if (action == undefined) {
			// place the cursor at the end of the tag's contents
			var rng = w.editor.selection.getRng(true);
			rng.selectNodeContents($('#'+id, w.editor.getBody())[0]);
			rng.collapse(false);
			w.editor.selection.setRng(rng);
		}
	};
	
	/**
	 * Change the attributes of a tag, or change the tag itself.
	 * @fires Writer#tagEdited
	 * @param tag {jQuery} A jQuery representation of the tag
	 * @param attributes {Object} An object of attribute names and values
	 */
	tagger.editStructureTag = function(tag, attributes) {
		// TODO add undo support
		var id = tag.attr('id');
		attributes.id = id;
		
		if (tag.attr('_tag') != attributes._tag) {
			// change the tag
			var tagName;
			if (tag.parent().is('span')) {
				// force inline if parent is inline
				tagName = 'span';
			} else {
				tagName = w.utilities.getTagForEditor(attributes._tag);
			}
			tag.contents().unwrap().wrap('<'+tagName+' id="'+id+'" />');
			tag = $('#'+id, w.editor.getBody());
			for (var key in attributes) {
				if (key.match(/^_/) != null || w.converter.reservedAttributes[key] !== true) {
					tag.attr(key, attributes[key]);
				}
			}
		} else {
			$.each($(tag[0].attributes), function(index, att) {
				if (w.converter.reservedAttributes[att.name] !== true) {
					tag.removeAttr(att.name);
				}
			});
			
			for (var key in attributes) {
				if (w.converter.reservedAttributes[key] !== true) {
					tag.attr(key, attributes[key]);
				}
			}
		}
		
		w.structs[id] = attributes;
		
		w.event('tagEdited').publish(id);
	};
	
	/**
	 * Remove a structure tag
	 * @fires Writer#tagRemoved
	 * @param {String} id Then tag id
	 * @param {Boolean} removeContents True to remove tag contents only
	 */
	tagger.removeStructureTag = function(id, removeContents) {
		_doCustomTaggerUndo();
		
		id = id || w.editor.currentStruct;
		
		if (removeContents == undefined) {
			if (w.tree && w.tree.currentlySelectedNode != null && w.tree.selectionType != null) {
				removeContents = true;
			}
		}
		
		var node = $('#'+id, w.editor.getBody());
		if (removeContents) {
			node.remove();
		} else {
			var parent = node.parent()[0];
			var contents = node.contents();
			if (contents.length > 0) {
				contents.unwrap();
			} else {
				node.remove();
			}
			parent.normalize();
		}
		
		w.event('tagRemoved').publish(id);
		
		w.editor.currentStruct = null;
	};
	
	/**
	 * Remove a structure tag's contents
	 * @fires Writer#tagContentsRemoved
	 * @param {String} id The tag id
	 */
	// TODO refactor this with removeStructureTag
	tagger.removeStructureTagContents = function(id) {
		_doCustomTaggerUndo();
		
		var node = $('#'+id, w.editor.getBody());
		node.contents().remove();
		
		w.event('tagContentsRemoved').publish(id);
	};
	
	w.event('tagRemoved').subscribe(tagger.findNewAndDeletedTags);
	w.event('tagContentsRemoved').subscribe(tagger.findNewAndDeletedTags);
	w.event('contentPasted').subscribe(tagger.findDuplicateTags);
	
	return tagger;
};

});
