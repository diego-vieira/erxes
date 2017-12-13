import _ from 'underscore';
import { Brands, Tags, Integrations, Customers, Segments } from '../../../db/models';
import { TAG_TYPES, INTEGRATION_KIND_CHOICES, COC_CONTENT_TYPES } from '../../constants';
import QueryBuilder from './segmentQueryBuilder';
import { moduleRequireLogin } from '../../permissions';
import { paginate } from './utils';

const listQuery = async params => {
  const selector = {};

  // Filter by segments
  if (params.segment) {
    const segment = await Segments.findOne({ _id: params.segment });
    const query = QueryBuilder.segments(segment);
    Object.assign(selector, query);
  }

  // filter by brand
  if (params.brand) {
    const integrations = await Integrations.find({ brandId: params.brand });
    selector.integrationId = { $in: integrations.map(i => i._id) };
  }

  // filter by integration
  if (params.integration) {
    const integrations = await Integrations.find({ kind: params.integration });
    /**
     * Since both of brand and integration filters use a same integrationId field
     * we need to intersect two arrays of integration ids.
     */
    const ids = integrations.map(i => i._id);
    const intersectionedIds = selector.integrationId
      ? _.intersection(ids, selector.integrationId.$in)
      : ids;

    selector.integrationId = { $in: intersectionedIds };
  }

  // Filter by tag
  if (params.tag) {
    selector.tagIds = params.tag;
  }

  return selector;
};

const customerQueries = {
  /**
   * Customers list
   * @param {Object} args
   * @return {Promise} filtered customers list by given parameters
   */
  async customers(root, { ids, searchValue, ...params }) {
    const sort = { 'messengerData.lastSeenAt': -1 };

    let selector = await listQuery(params);

    if (searchValue) {
      const fields = [
        { firstName: new RegExp(`.*${searchValue}.*`, 'i') },
        { lastName: new RegExp(`.*${searchValue}.*`, 'i') },
        { email: new RegExp(`.*${searchValue}.*`, 'i') },
        { phone: new RegExp(`.*${searchValue}.*`, 'i') },
      ];

      selector = { $or: fields };
    }

    if (ids) {
      selector = { _id: { $in: ids } };
    }

    return paginate(Customers.find(selector), params).sort(sort);
  },

  /**
   * Group customer counts by brands, segments, integrations, tags
   * @param {Object} args
   * @param {CustomerListParams} args.params
   * @return {Object} counts map
   */
  async customerCounts(root, params) {
    const counts = { bySegment: {}, byBrand: {}, byIntegrationType: {}, byTag: {} };
    const selector = await listQuery(params);

    const count = query => {
      const findQuery = Object.assign({}, selector, query);
      return Customers.find(findQuery).count();
    };

    // Count current filtered customers
    counts.all = await count(selector);

    // Count customers by segments
    const segments = await Segments.find({
      contentType: COC_CONTENT_TYPES.CUSTOMER,
    });

    for (let s of segments) {
      counts.bySegment[s._id] = await count(QueryBuilder.segments(s));
    }

    // Count customers by brand
    const brands = await Brands.find({});

    for (let brand of brands) {
      const integrations = await Integrations.find({ brandId: brand._id });

      counts.byBrand[brand._id] = await count({
        integrationId: { $in: integrations.map(i => i._id) },
      });
    }

    // Count customers by integration
    for (let kind of INTEGRATION_KIND_CHOICES.ALL) {
      const integrations = await Integrations.find({ kind });

      counts.byIntegrationType[kind] = await count({
        integrationId: { $in: integrations.map(i => i._id) },
      });
    }

    // Count customers by filter
    const tags = await Tags.find({ type: TAG_TYPES.CUSTOMER });

    for (let tag of tags) {
      counts.byTag[tag._id] = await count({ tagIds: tag._id });
    }

    return counts;
  },

  /**
   * Publishes customers list for the preview
   * when creating/editing a customer segment
   * @param {Object} segment   Segment that's being created/edited
   * @param {Number} [limit=0] Customers limit (for pagination)
   */
  async customerListForSegmentPreview(root, { segment, limit }) {
    const headSegment = await Segments.findOne({ _id: segment.subOf });

    const query = QueryBuilder.segments(segment, headSegment);
    const sort = { 'messengerData.lastSeenAt': -1 };

    return Customers.find(query)
      .sort(sort)
      .limit(limit);
  },

  /**
   * Get one customer
   * @param {Object} args
   * @param {String} args._id
   * @return {Promise} found customer
   */
  customerDetail(root, { _id }) {
    return Customers.findOne({ _id });
  },
};

moduleRequireLogin(customerQueries);

export default customerQueries;
