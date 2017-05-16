/*
 *  Copyright (c) 2015-2017, Michael A. Updike All rights reserved.
 *  Licensed under the BSD-3-Clause
 *  https://opensource.org/licenses/BSD-3-Clause
 *  https://github.com/opus1269/photo-screen-saver/blob/master/LICENSE.md
 */
window.app = window.app || {};
app.Flickr = (function() {
	'use strict';

	/**
	 * Interface to flickr API
	 * @namespace app.Flickr
	 */

	/**
	 * Flickr rest API
	 * @type {string}
	 * @const
	 * @default
	 * @private
	 * @memberOf app.Flickr
	 */
	const _URL_BASE = 'https://api.flickr.com/services/rest/';

	/**
	 * Flickr rest API authorization key
	 * @type {string}
	 * @const
	 * @private
	 * @memberOf app.Flickr
	 */
	const _KEY = '1edd9926740f0e0d01d4ecd42de60ac6';

	/**
	 * Max photos to return
	 * @type {int}
	 * @const
	 * @default
	 * @private
	 * @memberOf app.Flickr
	 */
	const _MAX_PHOTOS = 300;

	return {
		/**
		 * Retrieve flickr photos
		 * @returns {Promise<Photo[]>} Array of {@link Photo} objects
		 * @memberOf app.Flickr
		 */
		loadImages: function() {
			const url =
				`${_URL_BASE}?method=flickr.interestingness.getList` +
				`&api_key=${_KEY}&extras=owner_name,url_k,media` +
				`&per_page=${_MAX_PHOTOS}&format=json&nojsoncallback=1`;

			return app.Http.doGet(url).then((response) => {
				if (response.stat !== 'ok') {
					throw new Error(response.message);
				}
				const photos = [];
				for (let i = 0; i < response.photos.photo.length; i++) {
					const photo = response.photos.photo[i];
					if (photo && photo.url_k &&
						(photo.media === 'photo') &&
						(photo.isfriend !== '0') &&
						(photo.isfamily !== '0')) {
						const width = parseInt(photo.width_k, 10);
						const height = parseInt(photo.height_k, 10);
						const asp = width / height;
						app.Utils.addImage(photos, photo.url_k,
							photo.ownername, asp, photo.owner);
					}
				}
				return Promise.resolve(photos);
			});
		},
	};
})();
