var Dispatcher = require('../dispatcher/appDispatcher');
var EventEmitter = require('events').EventEmitter;
var assign = require('object-assign');
var request = require('superagent');

var FormStore = require('../stores/FormStore');
var APIActions = require('../actions/api');

function getCookie(name) {
    var cookieValue = null;
    if (document.cookie && document.cookie != '') {
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var cookie = cookies[i].trim();
            // Does this cookie string begin with the name we want?
            if (cookie.substring(0, name.length + 1) == (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

var APIStore = assign({}, EventEmitter.prototype);

APIStore.data = {};
APIStore.getRequests = [];

APIStore.getCollection = function(collectionType) {
  if (APIStore.data.hasOwnProperty(collectionType))
    return APIStore.data[collectionType];
  else
    return [];
};
APIStore.getCollectionLastItem = function(collectionType) {
  var collection = APIStore.getCollection(collectionType);
  if (collection.length > 0)
    return collection[collection.length -1];
  else
    return {};
};
APIStore.getFirstItemByPropertyValue = function(collectionType, propName, value){
  // Will return the first item that matches -- don't use for queries where you want multiple results.
  var collection = APIStore.getCollection(collectionType);
  if (!!collection && collection.length > 0) {
    for (var i=0; i<collection.length; i++){
      if (collection[i].hasOwnProperty(propName) && collection[i][propName] == value){
        return collection[i];
      }
    }
  }
  return {};
};
APIStore.filter = function(collectionType, propName, value){
  if (!APIStore.data.hasOwnProperty(collectionType)){
    APIStore.data[collectionType] = [];
  }
  var collection = APIStore.getCollection(collectionType);
  function match(el, index, collection){
    return (el.hasOwnProperty(propName) && el[propName] == value);
  }

  if (!!collection && collection.length > 0){
    return collection.filter(match);
  }
  else
    return [];
};

APIStore.addCollectionItem = function(collectionKey, item) {
  if (!APIStore.data.hasOwnProperty(collectionKey))
    APIStore.data[collectionKey] = [];
  APIStore.data[collectionKey].push(item);
  return item;
}

APIStore.hasAlreadyRequested = function(path){
  return (APIStore.getRequests.indexOf(path) > -1);
};


// listener utils
APIStore.addListener = function(type, callback) {
  APIStore.on(type, callback);
};

// Part of eventemitter
// APIStore.removeListener = function(type, callback)


// on startup
APIStore.storeInitialData = function() {
  var _initialData;

  // try to load the variable declared as initialData in the view template
  if (initialData) {
    // TODO: Add validation of types?
    _initialData = initialData
    for (key in _initialData){
      APIStore.data[key] = _initialData[key]
    }
  }
}


/* getData(): a common function for GETting needed data from the API so
 * that views may be rendered.
 * Params:
 *   context: a dictionary providing information about the API endpoint,
 *            expected return results and what to do with it.
 *       - actionUrl: the path starting with / to request from
 *       - successfulHttpStatus: [200] an array of success status codes
 *       - apiCollectionKey: where to put the retrieved data
*/
APIStore.getData = function(context){
  APIStore.getRequests.push(context.actionUrl);

  var req = request.get(context.actionUrl)
    .set('X-CSRFToken', getCookie('csrftoken'))
    .accept('application/json');

  req.end(function(error, response){
    console.log(response);
    if (error){
      console.log("THERE WAS SOME KIND OF API REQUEST ERROR.");
      console.log(error);
      APIStore.emit('API_STORE_FAILURE');
    }
    else if (context.successfulHttpStatus.indexOf(response.status) == -1){
      console.log("API REQUEST PROBLEM:");
      console.log(response.text);
      APIActions.APIGetResultFailure({
        message: {type: 'danger', content: response.status + " Error getting data: " + response.text}
      });
    }
    else {
      if (Array.isArray(response.body)){
        response.body.map(function(el, i, array){
          APIStore.addCollectionItem(context.apiCollectionKey, el);
        });
      }
      else {
        APIStore.addCollectionItem(context.apiCollectionKey,response.body);
      }
      APIStore.emit('DATA_UPDATED');
    }
  });

  return req;
};


/* postForm(): a common function for POSTing forms and returning results
 * to the FormStore.
 * Params:
 *   context: a dictionary providing information about the API endpoint
 *            and expected return results.
 *   fields: the form data from the FormStore.
 * This function will interrogate the data and attach appropriate fields
 * to the post request.
*/
APIStore.postForm = function(fields, values, context){

  if (context.method == 'POST')
    var req = request.post(context.actionUrl);
  else if (context.method == 'DELETE')
    var req = request.delete(context.actionUrl);
  else if (context.method == 'PUT')
    var req = request.put(context.actionUrl);

  req.set('X-CSRFToken', getCookie('csrftoken'))
  .accept('application/json');

  // Attach data fields to request
  for (field in fields) {
    if (["text", "textarea", "select", "checkbox"].indexOf(fields[field].inputType) > -1 && values[field])
      req.field(field, values[field]);
    else if (["image", "file"].indexOf(fields[field].inputType) > -1 && typeof values[field])
      req.attach(field, values[field], fields[field].filename);
  }

  req.end(function(error, response){
    console.log(response);
    if (error){
      console.log("THERE WAS SOME KIND OF API REQUEST ERROR.");
      console.log(error);
      APIStore.emit('API_STORE_FAILURE');
    }
    else if (context.successHttpStatus.indexOf(response.status) == -1){
      console.log("API REQUEST PROBLEM:");
      console.log(response.text);
      APIActions.APIFormResultFailure({
        formId: context.formId,
        message: {type: 'danger', content: response.status + " Error submitting form: " + response.text}
      });
    }
    else{
      var newObject = APIStore.addCollectionItem(context.apiCollectionKey, JSON.parse(response.text))
      if (newObject){
        APIStore.emit('DATA_UPDATED');
        APIActions.APIFormResultSuccess({
          formId: context.formId, 
          message: {type: 'success', content: context.successMessage},
          result: newObject
        });
      }
      else {
        APIStore.emit('API_STORE_FAILURE');
        console.log("Failed to add " + response.text + " to " + context.apiCollectionKey);
      }
    } 
  });

  return req;
}




// Register with the dispatcher
APIStore.dispatchToken = Dispatcher.register(function(payload){
  
  var action = payload.action;

  switch(action.type){
    case 'APP_WILL_MOUNT':
      APIStore.storeInitialData()
      APIStore.emit('INITIAL_DATA_LOADED');
      break;

    case 'FORM_SUBMIT':
      // make sure form updates have occurred before processing submits
      Dispatcher.waitFor([FormStore.dispatchToken]);

      if (FormStore.genericFormTypes.indexOf(action.formId) > -1){
        formData = FormStore.getFormData(action.formId);
        APIStore.postForm(formData.fieldsMeta, formData.formState, formData.apiContext);
      }
      else
        console.log("Unidentified form type to submit: " + action.formId);
      break;

    case 'API_GET_DATA':
      APIStore.getData(action.apiContext);
      break;

    default:
      // do naaathing.
  }
});

module.exports = {
  addListener: APIStore.addListener,
  removeListener: APIStore.removeListener,
  hasAlreadyRequested: APIStore.hasAlreadyRequested,
  getCollection: APIStore.getCollection,
  getCollectionLastItem: APIStore.getCollectionLastItem,
  getFirstItemByPropertyValue: APIStore.getFirstItemByPropertyValue,
  filter: APIStore.filter
}
