/*
@@license
*/
/*exported gPhotos*/
var gPhotos = (function() {
	'use strict';

	var PICASA_PATH = 'https://picasaweb.google.com/data/feed/api/user/';
	var PHOTOS_QUERY =
		'?imgmax=1600&thumbsize=72&fields=entry(media:group/media:content,media:group/media:credit)&v=2&alt=json';
	var MAX_RETRY = 5;

	/**
	 * Perform an http request using OAuth 2.0 authentication
	 *
	 * @param {string} method request type "POST" "GET" etc.
	 * @param {string} url url to call
	 * @param {string} callback (error, httpStatus, responseText)
	 *
	 */
	function authenticatedXhr(method, url, callback) {
		// callback(error, httpStatus, responseText)
		callback = callback || function() {};

		var retryToken = 0;
		var retryError = 0;
		var error = null;
		(function getTokenAndXhr() {
			chrome.identity.getAuthToken({'interactive': true},
											function(accessToken) {
				if (chrome.runtime.lastError) {
					callback(chrome.runtime.lastError.message);
					return;
				}

				var xhr = new XMLHttpRequest();
				xhr.open(method, url);
				xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
				xhr.send();

				xhr.onload = function() {
					if (this.status === 401 && retryToken < MAX_RETRY) {
						// This status may indicate that the cached
						// access token was invalid. Retry a few times with
						// a fresh token.
						retryToken++;
						chrome.identity.removeCachedAuthToken({'token': accessToken}, getTokenAndXhr);
						return;
					}

					if (this.status !== 200 && retryError < MAX_RETRY) {
						// Some error, retry a few times
						retryError++;
						console.log('Http error: ' + this.status + ' try again : ' + retryError);
						getTokenAndXhr();
						return;
					}

					if (this.status !== 200) {
						error = '<strong>Server status: ' + this.status + '</strong><p>' + this.responseText + '</p>';
					}
					callback(error, this.status, this.responseText);
				};

				xhr.onerror = function() {
					var error = '<strong>Network Request: Unknown error</strong>';
					if (chrome.runtime.lastError) {
						error = chrome.runtime.lastError.message;
					}
					callback(error);
				};
			});

		})();
	}

	/** Determine if a Picasa entry is an image
	 *
	 * @param {Object} entry Picasa media object
	 * @returns {boolean} true if entry is a photo
	 *
	 */
	function isImage(entry) {
		var content = entry.media$group.media$content;
		for (var i = 0; i < content.length ; i++) {
			if (content[i].medium !== 'image') {
				return false;
			}
		}
		return true;
	}

	/**
	 * Extract the Picasa photos into an Array
	 *
	 * @param {Object} root root object from Picasa API call
	 * @returns {Array} Array of photo objects
	 *
	 */
	function processPhotos(root) {
		var feed = root.feed;
		var entries = feed.entry || [], entry;
		var photos = [];
		var url,author,width,height,asp;

		for (var i = 0; i < entries.length; i++) {
			entry = entries[i];
			if (isImage(entry)) {
				url = entry.media$group.media$content[0].url;
				width = entry.media$group.media$content[0].width;
				height = entry.media$group.media$content[0].height;
				asp = width / height;
				author = entry.media$group.media$credit[0].$t;
				myUtils.addImage(photos, url, author, asp);
			}
		}
		return photos;
	}

	/**
	 * Retrieve the photos for the given album id
	 *
	 * @param {Integer} id Picasa album id
	 * @param {function} callback (error, photos)
	 *
	 */
	function loadPicasaAlbum(id, callback) {
		// callback(error, photos)
		callback = callback || function() {};

		var request = PICASA_PATH + 'default/albumid/' + id + '/' + PHOTOS_QUERY;

		authenticatedXhr('GET',request, function(error, httpStatus, responseText) {
			if (error) {
				callback(error);
				return;
			}
			callback(null, processPhotos(JSON.parse(responseText)));
		});
	}

	return {

		/**
		 * Get my photo album
		 *
		 * @param {function} callback (error, photos)
		 * 
		 */
		loadAuthorImages: function(callback) {
			// callback(error, photos)
			callback = callback || function() {};

			var authorID = '103839696200462383083';
			var authorAlbum = '6117481612859013089';
			var request = PICASA_PATH + authorID + '/albumid/' + authorAlbum + '/' + PHOTOS_QUERY;

			var xhr = new XMLHttpRequest();

			xhr.onload = function() {
				if (xhr.status === 200) {
					var photos = processPhotos(JSON.parse(xhr.responseText));
					callback(null, photos);
				} else {
					callback(xhr.responseText);
				}
			};

			xhr.onerror = function(e) {
				callback(e);
			};

			xhr.open('GET', request, true);
			xhr.send();
		},

		/**
		 * Retrieve the users list of albums, including the photos in each
		 *
		 * @param {function} callback (error, albumList)
		 *
		 */
		loadAlbumList: function(callback) {
			// callback(error, albums)
			callback = callback || function() {};

			var albumListQuery = '?v=2&thumbsize=72&visibility=all&kind=album&alt=json';
			var request = PICASA_PATH + 'default/' + albumListQuery;

			authenticatedXhr('GET',request, function(error, httpStatus, responseText) {
				if (error) {
					callback(error);
					return;
				}

				var root = JSON.parse(responseText);
				var feed = root.feed;
				var entries = feed.entry || [];
				var albumList = [], album;
				var ct = 0;

				for (var i = 0; i < entries.length; ++i) {
					(function(index) {
						loadPicasaAlbum(entries[index].gphoto$id.$t, function(error, photos) {
							if (error) {
								callback(error);
								return;
							}

							if (!entries[index].gphoto$albumType && photos.length) {
								album = {};
								album.index = index;
								album.uid = 'album' + index;
								album.name = entries[index].title.$t;
								album.id = entries[index].gphoto$id.$t;
								album.ct = photos.length;
								album.thumb = entries[index].media$group.media$thumbnail[0].url;
								album.checked = false;
								album.photos = photos;
								albumList.push(album);
							}
							if (ct === (entries.length - 1)) {
								albumList.sort(function(a, b) {
									return a.index - b.index;
								});
								callback(null, albumList);
							}
							ct++;
						});
					})(i);
				}
			});
		},

		/**
		 * Retrieve the photos in the selected albums
		 *
		 * @param {function} callback (error, items) Array of Array of album photos on success
		 *
		 */
		loadImages: function(callback) {
			// callback(error, items)
			callback = callback || function() {};

			var ct = 0;
			var items = JSON.parse(localStorage.albumSelections);
			var newItems = [];

			for (var i = 0; i < items.length; i++) {
				(function(index) {
					loadPicasaAlbum(items[index].id, function(error, photos) {
						if (error) {
							// this may just mean the user deleted an album
							console.log(error);
						} else if (photos.length) {
							newItems.push({id: items[index].id, photos: photos});
						}

						if (ct === (items.length - 1)) {
							// done
							callback(null, newItems);
							return;
						}
						ct++;
					});
				})(i);
			}
		}

	};
})();
