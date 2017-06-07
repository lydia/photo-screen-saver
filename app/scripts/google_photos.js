/*
 *  Copyright (c) 2015-2017, Michael A. Updike All rights reserved.
 *  Licensed under the BSD-3-Clause
 *  https://opensource.org/licenses/BSD-3-Clause
 *  https://github.com/opus1269/photo-screen-saver/blob/master/LICENSE.md
 */
window.app = window.app || {};

/**
 * Interface to Picasa API
 * @namespace
 */
app.GooglePhotos = (function() {
  'use strict';

  new ExceptionHandler();

  /**
   * A Google Photo Album
   * @typedef {Object} app.GooglePhotos.Album
   * @property {int} index - Array index
   * @property {string} uid - unique identifier
   * @property {string} name - album name
   * @property {string} id - Google album Id
   * @property {string} thumb - thumbnail url
   * @property {boolean} checked - is album selected
   * @property {int} ct - number of photos
   * @property {app.PhotoSource.SourcePhoto[]} photos - Array of photos
   * @memberOf app.GooglePhotos
   */

  /**
   * A Selected Google Photo Album
   * @typedef {Object} app.GooglePhotos.SelectedAlbum
   * @property {string} id - Google album Id
   * @property {app.PhotoSource.SourcePhoto[]} photos - Array of photos
   * @memberOf app.GooglePhotos
   */

  /**
   * Path to Picasa API
   * @type {string}
   * @const
   * @default
   * @private
   * @memberOf app.GooglePhotos
   */
  const _URL_BASE = 'https://picasaweb.google.com/data/feed/api/user/';

  /**
   * Query for list of albums
   * @type {string}
   * @const
   * @default
   * @private
   * @memberOf app.GooglePhotos
   */
  const _ALBUMS_QUERY = '?max-results=2000&visibility=all&kind=album' +
      '&fields=entry(gphoto:albumType,gphoto:id)&v2&alt=json';

  /**
   * Query an album
   * @type {string}
   * @const
   * @default
   * @private
   * @memberOf app.GooglePhotos
   */
  const _ALBUM_QUERY = '?imgmax=1600&thumbsize=72' +
      '&fields=title,gphoto:id,entry(media:group/media:content,' +
      'media:group/media:credit,media:group/media:thumbnail,georss:where)' +
      '&v=2&alt=json';

  /** Determine if a Picasa entry is an image
   * @param {Object} entry - Picasa media object
   * @returns {boolean} true if entry is a photo
   * @private
   * @memberOf app.GooglePhotos
   */
  function _isImage(entry) {
    const content = entry.media$group.media$content;
    for (let i = 0; i < content.length; i++) {
      if (content[i].medium !== 'image') {
        return false;
      }
    }
    return true;
  }

  /** Determine if a Picasa entry has Geo position
   * @param {Object} entry - Picasa media object
   * @returns {boolean} true if entry has Geo position
   * @private
   * @memberOf app.GooglePhotos
   */
  function _hasGeo(entry) {
    return !!(entry.georss$where &&
    entry.georss$where.gml$Point &&
    entry.georss$where.gml$Point.gml$pos &&
    entry.georss$where.gml$Point.gml$pos.$t);
  }

  /** Get the thumbnail url if it exists
   * @param {Array} entry - Picasa media object
   * @returns {?string} url or null
   * @private
   * @memberOf app.GooglePhotos
   */
  function _getThumbnail(entry) {
    let ret = null;
    if (entry.length &&
        entry[0].media$group &&
        entry[0].media$group.media$thumbnail[0]) {
      ret = entry[0].media$group.media$thumbnail[0].url;
    }
    return ret;
  }

  /**
   * Extract the Picasa photos into an Array
   * @param {Object} root - root object from Picasa API call
   * @returns {app.PhotoSource.SourcePhoto[]} Array of photos
   * @private
   * @memberOf app.GooglePhotos
   */
  function _processPhotos(root) {
    const photos = [];
    if (root) {
      const feed = root.feed;
      const entries = feed.entry || [];
      entries.forEach((entry) => {
        if (_isImage(entry)) {
          const url = entry.media$group.media$content[0].url;
          const width = entry.media$group.media$content[0].width;
          const height = entry.media$group.media$content[0].height;
          const asp = width / height;
          const author = entry.media$group.media$credit[0].$t;
          let point;
          if (_hasGeo(entry)) {
            point = entry.georss$where.gml$Point.gml$pos.$t;
          }
          app.PhotoSource.addPhoto(photos, url, author, asp, {},
              point);
        }
      });
    }
    return photos;
  }

  /**
   * Retrieve a Google Photos album
   * @param {string} albumId - Picasa album ID
   * @param {string} [userId='default'] - userId for non-authenticated request
   * @returns {Promise<Object>} Root object from Picasa call null if not found
   * @private
   * @memberOf app.GooglePhotos
   */
  function _loadPicasaAlbum(albumId, userId = 'default') {
    const url = `${_URL_BASE}${userId}/albumid/${albumId}/${_ALBUM_QUERY}`;
    if (userId === 'default') {
      return app.Http.doGet(url, true).catch((err) => {
        const statusMsg = `${app.Utils.localize('err_status')}: 404`;
        if (err.message.includes(statusMsg)) {
          // album was probably deleted
          return Promise.resolve(null);
        } else {
          throw err;
        }
      });
    } else {
      return app.Http.doGet(url);
    }
  }

  return {
    /**
     * Retrieve the users list of albums, including the photos in each
     * @param {boolean} interactive - true is user initiated call
     * @returns {Promise<app.GooglePhotos.Album[]>} Array of albums
     * @memberOf app.GooglePhotos
     */
    loadAlbumList: function(interactive = false) {
      const url = `${_URL_BASE}default/${_ALBUMS_QUERY}`;

      // get list of albums
      return app.Http.doGet(url, true, true, interactive).then((root) => {
        if (!root || !root.feed || !root.feed.entry) {
          throw new Error(app.Utils.localize('err_no_albums'));
        }

        const feed = root.feed;

        // series of API calls to get each album
        const promises = [];
        const entries = feed.entry || [];
        entries.forEach((entry) => {
          if (!entry.gphoto$albumType) {
            // skip special albums (e.g. Google+ posts, backups)
            const albumId = entry.gphoto$id.$t;
            promises.push(_loadPicasaAlbum(albumId));
          }
        });

        // Collate the albums
        return Promise.all(promises);
      }).then((vals) => {
        /** @type {app.GooglePhotos.Album[]} */
        let albums = [];
        let ct = 0;
        const values = vals || [];
        values.forEach((value) => {
          if (value !== null) {
            const feed = value.feed;
            if (feed && feed.entry) {
              const thumb = _getThumbnail(feed.entry);
              const photos = _processPhotos(value);
              if (photos && photos.length) {
                /** @type {app.GooglePhotos.Album} */
                const album = {};
                album.index = ct;
                album.uid = 'album' + ct;
                album.name = feed.title.$t;
                album.id = feed.gphoto$id.$t;
                album.ct = photos.length;
                album.thumb = thumb;
                album.checked = false;
                album.photos = photos;
                albums.push(album);
                ct++;
              }
            }
          }
        });
        return Promise.resolve(albums);
      });
    },

    /**
     * Retrieve the photos in the selected albums
     * @returns {Promise<app.GooglePhotos.SelectedAlbum[]>} Array albums
     * @memberOf app.GooglePhotos
     */
    loadPhotos: function() {
      let vals = Chrome.Storage.get('albumSelections');

      // series of API calls to get each album
      const promises = [];
      const albums = vals || [];
      albums.forEach((album) => {
        promises.push(_loadPicasaAlbum(album.id));
      });

      // Collate the albums
      return Promise.all(promises).then((vals) => {
        /** @type {app.GooglePhotos.SelectedAlbum[]} */
        const albums = [];
        const values = vals || [];
        values.forEach((value) => {
          if (value) {
            const feed = value.feed;
            const photos = _processPhotos(value);
            if (photos && photos.length) {
              albums.push({
                id: feed.gphoto$id.$t,
                photos: photos,
              });
            }
          }
        });
        return Promise.resolve(albums);
      });
    },
  };
})();
