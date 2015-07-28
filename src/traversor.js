var errorUtil = require('./errorUtil'),
    stringUtil = require('./stringUtil'),
    ylcBindParser = require('./parser/ylcBind'),
    domTemplates = require('./domTemplates'),
    ylcEventsParser = require('./parser/ylcEvents'),
    ylcLoopParser = require('./parser/ylcLoop'),
    domAnnotator = require('./domAnnotator'),
    contextFactory = require('./contextFactory'),
    annotationProcessor = require('./annotationProcessor');

module.exports = {};

module.exports.setupTraversal = function(pModel, pDomView, pController) {

    var EMPTY_FUNCTION = function () {},
        PREFIELD = {},
        my = {};

    function m2vOnlyAnnotationListener(annotation, code, metadata) {
        if (annotation === "m2vOnly") {
            metadata.m2vOnly = true;
        }
    }

    function beforeAfterEventAnnotationListener(annotation, code, metadata) {
        if (annotation === "beforeEvent") {
            my.callbacks.beforeEvent.push(code);

        } else if (annotation === "afterEvent") {
            my.callbacks.afterEvent.push(code);
        }
    }

    function extractControllerMethods(controller) {
        return annotationProcessor.processAnnotations(
            controller,
            [
                m2vOnlyAnnotationListener,
                beforeAfterEventAnnotationListener
            ]
        );
    }

    function v2mSetValues(context, domElement) {

        var jqElement = $(domElement),
            strYlcBind = stringUtil.strGetData(jqElement, "ylcBind"),
            arrYlcBind = ylcBindParser.parseYlcBind(strYlcBind),
            idxYlcBind,
            currentYlcBinding,
            fnGetter,
            value,
            forceSet;

        for (idxYlcBind = 0; idxYlcBind < arrYlcBind.length; idxYlcBind += 1) {
            currentYlcBinding = arrYlcBind[idxYlcBind];

            if (currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_BIDIRECTIONAL &&
                currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_V2M_ONLY &&
                currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_V2M_ONLY_FORCED) {
                continue;
            }

            forceSet = currentYlcBinding.strMappingOperator === ylcBindParser.MAPPING_V2M_ONLY_FORCED;

            if (stringUtil.isEmpty(currentYlcBinding.strPropertyName)) {
                value = jqElement.get();

            } else {
                fnGetter = jqElement[currentYlcBinding.strPropertyName];

                if (!fnGetter instanceof Function) {
                    throw errorUtil.createError(
                        "Cannot find jQuery getter/setter called '" +
                        currentYlcBinding.strPropertyName + "'.",
                        my.domView
                    );
                }

                if (currentYlcBinding.strSubpropertyName === undefined) {
                    value = fnGetter.call(jqElement);
                } else {
                    value = fnGetter.call(jqElement, currentYlcBinding.strSubpropertyName);
                }
            }

            try {
                context.setValue(currentYlcBinding.strBindingExpression, value, forceSet);

            } catch (err) {
                throw errorUtil.elementToError(err, domElement);
            }
        }
    }

    function getGeneratedElements(jqTemplate) {
        var domarrResult = [],
            jqCurrentSibling;

        jqCurrentSibling = jqTemplate;

        while (true) {
            jqCurrentSibling = jqCurrentSibling.next();

            if (jqCurrentSibling.get() === undefined || !domTemplates.isDynamicallyGenerated(jqCurrentSibling)) {
                break;
            }

            domarrResult.push(jqCurrentSibling.get());
        }

        return domarrResult;
    }

    function checkIterable(arrCollection) {
        if (!(arrCollection instanceof Array)) {
            throw errorUtil.createError(
                "Attempt to iterate through a non-array value: " +
                arrCollection
            );
        }
    }

    function v2mProcessDynamicElements(
        context,
        jqTemplate
    ) {

        var strYlcLoop = stringUtil.strGetData(jqTemplate, "ylcLoop"),
            strYlcIf = stringUtil.strGetData(jqTemplate, "ylcIf");

        if (strYlcLoop && strYlcIf) {
            throw errorUtil.createError(
                "An element contains both data-ylcLoop and data-ylcIf.",
                jqTemplate.get()
            );
        }

        if (strYlcLoop) {
            return v2mProcessDynamicLoopElements(
                context,
                jqTemplate
            );
        }

        if (strYlcIf) {
            return v2mProcessDynamicIfElements(
                context,
                jqTemplate
            );
        }

        errorUtil.assert(false);

    }

    function v2mProcessElement(context, domElement) {
        var nElementsProcessed;

        if (domTemplates.isTemplate(domElement)) {
            nElementsProcessed = v2mProcessDynamicElements(
                context,
                $(domElement),
                my.controller
            );

        } else if (domElement !== my.domView && domAnnotator.isViewRoot($(domElement))) {
            nElementsProcessed = 1;

        } else {
            v2mSetValues(context, domElement);
            v2mProcessChildren(context, domElement);
            nElementsProcessed = 1;
        }

        return nElementsProcessed;
    }

    function v2mProcessDynamicLoopElements(
        context,
        jqTemplate
    ) {
        var idxWithinDynamicallyGenerated,
            ylcLoop = ylcLoopParser.parseYlcLoop(stringUtil.strGetData(jqTemplate, "ylcLoop")),
            arrCollection = context.getValue(ylcLoop.strCollectionName),
            domarrGeneratedElements = getGeneratedElements(jqTemplate),
            domDynamicallyGeneratedElement,
            nProcessed;

        checkIterable(arrCollection);

        for (idxWithinDynamicallyGenerated = 0;
             idxWithinDynamicallyGenerated < domarrGeneratedElements.length;
             idxWithinDynamicallyGenerated += 1) {

            domDynamicallyGeneratedElement =
                domarrGeneratedElements[idxWithinDynamicallyGenerated];

            context.enterIteration(
                ylcLoop.strLoopVariable,
                arrCollection,
                ylcLoop.strStatusVariable,
                idxWithinDynamicallyGenerated
            );

            nProcessed =
                v2mProcessElement(
                    context,
                    domDynamicallyGeneratedElement
                );
            errorUtil.assert(
                nProcessed === 1,
                "A template can't be a dynamically generated element."
            );

            context.exitIteration(
                ylcLoop.strLoopVariable,
                ylcLoop.strStatusVariable
            );
        }

        return domarrGeneratedElements.length + 1;
    }

    function v2mProcessDynamicIfElements(
        context,
        jqTemplate
    ) {
        var domarrCurrentGeneratedElements = getGeneratedElements(jqTemplate);

        if (domarrCurrentGeneratedElements.length > 0) {
            errorUtil.assert(domarrCurrentGeneratedElements.length === 1);
            v2mProcessElement(
                context,
                domarrCurrentGeneratedElements[0]
            );
        }

        return domarrCurrentGeneratedElements.length + 1;
    }

    function v2mProcessChildren(context, domElement) {
        var jqDomElement = $(domElement),
            jqsetChildren = jqDomElement.children(),
            index = 0,
            domChild;

        while (index < jqsetChildren.length) {
            domChild = jqsetChildren[index];
            index += v2mProcessElement(context, domChild);
        }
    }


    // propagating changes of model into view

    function m2vSetValues(context, domElement) {
        var jqElement = $(domElement),
            strYlcBind = stringUtil.strGetData(jqElement, "ylcBind"),
            arrYlcBind = ylcBindParser.parseYlcBind(strYlcBind),

            index,
            currentYlcBinding,
            fnSetter,
            value;

        for (index = 0; index < arrYlcBind.length; index += 1) {
            currentYlcBinding = arrYlcBind[index];

            if (currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_BIDIRECTIONAL &&
                currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_M2V_ONLY) {
                continue;
            }

            // an empty property maps straight to the DOM element, which is read only
            if (stringUtil.isEmpty(currentYlcBinding.strPropertyName)) {
                continue;
            }

            fnSetter = jqElement[currentYlcBinding.strPropertyName];
            if (!(fnSetter instanceof Function)) {
                throw errorUtil.createError(
                    "Cannot find jQuery getter/setter called '" +
                    currentYlcBinding.strPropertyName + "'.",
                    domElement
                );
            }

            try {
                value = context.getValue(currentYlcBinding.strBindingExpression);

            } catch (err) {
                throw errorUtil.elementToError(err, domElement);
            }

            if (value !== PREFIELD) {
                if (currentYlcBinding.strSubpropertyName === undefined) {
                    fnSetter.call(jqElement, value);

                } else {
                    fnSetter.call(jqElement, currentYlcBinding.strSubpropertyName, value);
                }
            }

        }

    }

    function processCommonElements(
        context,
        ylcLoop,
        domarrCurrentGeneratedElements,
        arrCollection,
        commonLength
    ) {
        var index = 0,
            domGeneratedElement;

        while (index < commonLength) {
            domGeneratedElement = domarrCurrentGeneratedElements[index];

            context.enterIteration(
                ylcLoop.strLoopVariable,
                arrCollection,
                ylcLoop.strStatusVariable,
                index
            );

            index +=
                m2vProcessElement(
                    context,
                    domGeneratedElement,
                    false
                );

            context.exitIteration(ylcLoop.strLoopVariable, ylcLoop.strStatusVariable);
        }
    }

    function addExtraElements(
        context,
        ylcLoop,
        jqTemplate,
        domarrCurrentGeneratedElements,
        arrCollection,
        commonLength
    ) {

        var jqLastCommonElement,
            jqLastElement,

            index,
            jqNewDynamicElement,
            elementsProcessed;

        if (commonLength === 0) {
            jqLastCommonElement = jqTemplate;
        } else {
            jqLastCommonElement = $(domarrCurrentGeneratedElements[commonLength - 1]);
        }

        jqLastElement = jqLastCommonElement;
        for (index = commonLength; index < arrCollection.length; index += 1) {

            jqNewDynamicElement = domTemplates.jqCreateElementFromTemplate(jqTemplate);

            context.enterIteration(
                ylcLoop.strLoopVariable,
                arrCollection,
                ylcLoop.strStatusVariable,
                index
            );

            elementsProcessed =
                m2vProcessElement(context, jqNewDynamicElement.get(), true);
            errorUtil.assert(
                elementsProcessed === 1,
                "If an element is dynamically generated, it can't be a template."
            );

            context.exitIteration(ylcLoop.strLoopVariable, ylcLoop.strStatusVariable);

            jqLastElement.after(jqNewDynamicElement);
            jqLastElement = jqNewDynamicElement;

        }
    }

    function m2vProcessDynamicLoopElements(
        context,
        jqTemplate,
        strYlcLoop
    ) {

        var ylcLoop = ylcLoopParser.parseYlcLoop(strYlcLoop),
            domarrCurrentGeneratedElements =
                getGeneratedElements(jqTemplate),
            arrCollection = context.getValue(ylcLoop.strCollectionName),
            commonLength,
            idxFirstToDelete,
            index;

        checkIterable(arrCollection);

        commonLength =
            Math.min(arrCollection.length, domarrCurrentGeneratedElements.length);

        processCommonElements(
            context,
            ylcLoop,
            domarrCurrentGeneratedElements,
            arrCollection,
            commonLength
        );

        if (arrCollection.length > commonLength) {
            addExtraElements(
                context,
                ylcLoop,
                jqTemplate,
                domarrCurrentGeneratedElements,
                arrCollection,
                commonLength
            );
        }

        if (domarrCurrentGeneratedElements.length > commonLength) {
            idxFirstToDelete = arrCollection.length;
            for (index = idxFirstToDelete;
                 index < domarrCurrentGeneratedElements.length;
                 index += 1) {
                $(domarrCurrentGeneratedElements[index]).remove();
            }
        }

        return domarrCurrentGeneratedElements.length + 1;
    }

    function m2vProcessDynamicIfElements(
        context,
        jqTemplate,
        strYlcIf
    ) {
        var ifExpressionValue = context.getValue(stringUtil.normalizeWhitespace(strYlcIf)),
            domarrCurrentGeneratedElements = getGeneratedElements(jqTemplate),
            jqNewDynamicElement,
            nElementsProcessed;

        if (ifExpressionValue && domarrCurrentGeneratedElements.length === 0) {
            jqNewDynamicElement = domTemplates.jqCreateElementFromTemplate(jqTemplate);

            nElementsProcessed =
                m2vProcessElement(context, jqNewDynamicElement.get(), true);
            errorUtil.assert(
                nElementsProcessed === 1,
                "If an element is dynamically generated, it can't be a template."
            );

            jqTemplate.after(jqNewDynamicElement);

        } else if (domarrCurrentGeneratedElements.length > 0) {
            if (ifExpressionValue) {
                nElementsProcessed =
                    m2vProcessElement(
                        context,
                        domarrCurrentGeneratedElements[0],
                        false
                    );

            } else {
                errorUtil.assert(domarrCurrentGeneratedElements.length === 1);
                $(domarrCurrentGeneratedElements[0]).remove();
            }

        }

        return domarrCurrentGeneratedElements.length + 1;

    }

    function m2vProcessDynamicElements(
        context,
        jqTemplate
    ) {

        var strYlcLoop = stringUtil.strGetData(jqTemplate, "ylcLoop"),
            strYlcIf = stringUtil.strGetData(jqTemplate, "ylcIf");

        if (strYlcLoop && strYlcIf) {
            throw errorUtil.createError(
                "An element can't contain both data-ylcLoop and data-ylcIf. " +
                "Please use an embedded DIV.",
                jqTemplate.get()
            );
        }

        if (strYlcLoop) {
            return m2vProcessDynamicLoopElements(
                context,
                jqTemplate,
                strYlcLoop
            );
        }

        if (strYlcIf) {
            return m2vProcessDynamicIfElements(
                context,
                jqTemplate,
                strYlcIf
            );
        }

        errorUtil.assert(false);
    }

    function m2vProcessChildren(
        context,
        domElement,
        bBindEvents
    ) {

        var jqElement = $(domElement),
            jqsetChildren = jqElement.children(),

            index,
            domChild;

        index = 0;

        while (index < jqsetChildren.length) {
            domChild = jqsetChildren[index];

            try {

                index +=
                    m2vProcessElement(
                        context,
                        domChild,
                        bBindEvents
                    );

            } catch (err) {
                throw errorUtil.elementToError(err, domChild);
            }
        }

    }

    function callFunctions(arrCallbacks) {
        $.each(
            arrCallbacks,
            function (idx, fn) {
                fn.call(my.controller);
            }
        )
    }

    function callModelUpdatingMethod(
        context,
        publicContext,
        fnUpdateMethod,
        m2vOnly
    ) {

        var returnValue;

        try {

            callFunctions(my.callbacks.beforeEvent);

            if (!m2vOnly) {
                v2mProcessElement(
                    context,
                    my.domView
                );
            }

            returnValue = fnUpdateMethod.call(my.controller, my.model, publicContext);

            m2vProcessElement(
                context,
                my.domView,
                false
            );

            callFunctions(my.callbacks.afterEvent);

        } catch (error) {
            errorUtil.printAndRethrow(error);
        }

        return returnValue;

    }

    function createHandler(context, publicContext, fnHandler, m2vOnly) {

        return function (eventObject) {
            publicContext.eventObject = eventObject;

            return callModelUpdatingMethod(
                context,
                publicContext,
                fnHandler,
                m2vOnly
            );
        };
    }

    function m2vBindEvents(context, domElement) {
        var jqElement = $(domElement),
            strYlcEvents = stringUtil.strGetData(jqElement, "ylcEvents"),
            arrYlcEvents = ylcEventsParser.parseYlcEvents(strYlcEvents),

            index,
            currentYlcEvent,
            fnHandler,
            publicContext,
            annotatedControllerFunction,

            m2vOnly;

        for (index = 0; index < arrYlcEvents.length; index += 1) {
            currentYlcEvent = arrYlcEvents[index];
            m2vOnly = false;

            if (currentYlcEvent.strMethodName.length === 0) {
                fnHandler = EMPTY_FUNCTION;

            } else {
                annotatedControllerFunction = my.controllerMethods[currentYlcEvent.strMethodName];
                if (annotatedControllerFunction) {
                    fnHandler = annotatedControllerFunction.code;
                    if (annotatedControllerFunction.metadata.m2vOnly) {
                        m2vOnly = true;
                    }
                }
            }

            if (!(fnHandler instanceof Function)) {
                throw errorUtil.createError(
                    "Event handler '" + currentYlcEvent.strMethodName + "', " +
                    "specified for event '" + currentYlcEvent.strEventName + "', " +
                    "is not a function.",
                    domElement
                );
            }

            publicContext =
                createPublicContext(context, domElement);

            if (currentYlcEvent.strEventName === "ylcElementInitialized") {
                fnHandler.call(my.controller, my.model, publicContext);
            }

            jqElement.bind(
                currentYlcEvent.strEventName,
                createHandler(context, publicContext, fnHandler, m2vOnly)
            );
        }

    }

    function createPublicContext(context, domElement) {
        var publicContext = {};

        publicContext.PREFIELD = PREFIELD;

        publicContext.domElement = domElement;
        publicContext.loopStatuses = context.getLoopStatusesSnapshot();
        publicContext.updateModel = function (fnUpdateMethod) {
            return callModelUpdatingMethod(
                context,
                publicContext,
                fnUpdateMethod
            );
        };

        return publicContext;
    }

    function m2vProcessElement(context, domElement, bBindEvents) {
        var nElementsProcessed;

        if (domTemplates.isTemplate(domElement)) {
            nElementsProcessed = m2vProcessDynamicElements(
                context,
                $(domElement)
            );

        } else if (domElement !== my.domView && domAnnotator.isViewRoot($(domElement))) {
            nElementsProcessed = 1;

        } else {
            if (bBindEvents) {
                m2vBindEvents(context, domElement);
            }
            m2vSetValues(context, domElement);
            $(domElement).removeClass("ylcInvisibleTemplate");
            m2vProcessChildren(context, domElement, bBindEvents);

            nElementsProcessed = 1;
        }

        return nElementsProcessed;
    }










    function getProperties(object) {
        var result = [],
            property;

        for (property in object) {
            if (object.hasOwnProperty(property)) {
                result.push(property);
            }
        }

        return result;
    }

    function createAdapter(context, domView, controller) {

        var adapter = {},
            controllerMethodNames = getProperties(controller),
            adapterMethodArguments;

        $.each(controllerMethodNames, function (idxProperty, currentMethodName) {
            var currentControllerMethod = controller[currentMethodName];

            if (currentControllerMethod instanceof Function) {
                adapter[currentMethodName] = function () {

                    var returnValue;

                    adapterMethodArguments =
                        [
                            my.model,
                            createPublicContext(context, null)
                        ];
                    $.each(arguments, function (index, argument) {
                        adapterMethodArguments.push(argument);
                    });

                    returnValue = currentControllerMethod.apply(controller, adapterMethodArguments);

                    m2vProcessElement(
                        context,
                        domView,
                        false
                    );

                    return returnValue;
                };
            }

        });

        return adapter;
    }

    function processExternalEvent(context, domView, controller, communicationObject) {
        if (communicationObject.eventName === "getAdapter") {
            communicationObject.result = createAdapter(context, domView, controller);
        }
    }

    function registerYlcExternalEvent(context, domView, controller) {
        $(domView).bind(
            "_ylcExternalEvent",
            function (event, communicationObject) {
                processExternalEvent(context, domView, controller, communicationObject);
                return false;
            }
        );
    }

    function setupViewForYlcTraversal() {

        $(my.domView).find(":not([data-ylcIf=''])").addClass("ylcInvisibleTemplate");
        $(my.domView).find(":not([data-ylcLoop=''])").addClass("ylcInvisibleTemplate");
        domAnnotator.markViewRoot($(my.domView));

        var context = contextFactory.newContext(my.model, my.controller, my.controllerMethods);
        if (my.controller.init instanceof Function) {
            my.controller.init.call(
                my.controller,
                my.model,
                createPublicContext(context, my.domView)
            );
        }

        m2vProcessElement(
            context,
            my.domView,
            true
        );

        registerYlcExternalEvent(context, my.domView, my.controller);

    }

    my.model = pModel;
    my.domView = pDomView;
    my.controller = pController;

    my.callbacks = {
        beforeEvent: [],
        afterEvent: []
    };
    my.controllerMethods = extractControllerMethods(pController);

    setupViewForYlcTraversal();

};

module.exports.triggerExternalEvent = function(domView, eventName, parameter) {

    var communicationObject = {
        eventName: eventName,
        parameter: parameter,
        result: undefined
    };

    $(domView).trigger("_ylcExternalEvent", communicationObject);

    return communicationObject.result;
};