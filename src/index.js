const {
  CookieKonnector,
  requestFactory,
  scrape,
  log,
  utils
} = require('cozy-konnector-libs')
var crypto = require('crypto');

const baseUrl = 'https://extranet.cgalr.fr'

class CGALRConnector extends CookieKonnector
{
  constructor()
  {
    super()
    this.request = requestFactory({
      // The debug mode shows all the details about HTTP requests and responses. Very useful for
      // debugging but very verbose. This is why it is commented out by default
      // debug: true,
      // Activates [cheerio](https://cheerio.js.org/) parsing on each page
      cheerio: true,
      // If cheerio is activated do not forget to deactivate json parsing (which is activated by
      // default in cozy-konnector-libs
      json: false,
      // This allows request-promise to keep cookies between requests
      jar: true
    })
    
  }

  testSession() {
    return (this._jar.length > 0)
  }
  async fetch (fields) {
    log('info', 'Authenticating ...')
  
    await this.authenticate.bind(this)(fields.login, fields.password)
    log('info', 'Successfully logged in')
    // The BaseKonnector instance expects a Promise as return of the function
    

    // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
    log('info', 'Parsing list of documents')
    const documents = await this.parseDocuments()
  
    // Here we use the saveBills function even if what we fetch are not bills,
    // but this is the most common case in connectors
    log('info', 'Saving data to Cozy')
    await this.saveFiles(documents, fields, {
      timeout: Date.now() + 300 * 1000
    })

  }
  // This shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
async authenticate(username, password) {
  return this.signin({
    url: `https://extranet.cgalr.fr/extranet/index_extranet.php`,
    formSelector: 'form',
    formData: { clogin: username, 
                md5: crypto.createHash('md5').update(password).digest("hex")},

    // The validate function will check if the login request was a success. Every website has a
    // different way to respond: HTTP status code, error message in HTML ($), HTTP redirection
    // (fullResponse.request.uri.href)...
    validate: (statusCode, $, fullResponse) => {
      log(
        'debug',
        fullResponse.request.uri.href,
        'not used here but should be useful for other connectors'
      )
      // The login in toscrape.com always works except when no password is set
      if ($(`a[href='/extranet/close.php']`).length === 1) {
        return true
      } else {
        // cozy-konnector-libs has its own logging function which format these logs with colors in
        // standalone and dev mode and as JSON in production mode
        log('error', $('.error').text())
        return false
      }
    }
  })
}

formatURL(sURLRelative)
{
  const myURL = new URL(baseUrl+"/"+sURLRelative);
  
  return myURL.toString()
}
// The goal of this function is to parse a HTML page wrapped by a cheerio instance
// and return an array of JS objects which will be saved to the cozy by saveBills
// (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
async parseDocuments() {

  log('info', 'Fetching the list of documents')
  const $ = await this.request(`https://extranet.cgalr.fr/template/link_template.php?page=mailmenu`)

  // You can find documentation about the scrape function here:
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  const ListeAnnees = scrape(
    $,
    {
      annee: {
        sel: 'a'
      },
      url: {
        sel: 'a',
        attr: 'href',
        parse: src =>  `${baseUrl}/${src}`
      }
    },
    '#navs ul li'
  )
  
  var ListeDocs = []
  var DocAnnee = []
  // On parcourt les années
  for (const UneAnnee of ListeAnnees) {

    // On récupère la page de l'année
    const o = await this.request(UneAnnee.url)
    DocAnnee = scrape(
      o,
      {    
        filename: {
          sel: 'td:nth-child(3) a',
        },
        date: {
          sel:'td:nth-child(4)',
          parse: str => this.DateFromString(str)
        },
        fileurl: {
          sel: 'td:nth-child(5) a',
          attr: 'href',
          parse: src => this.formatURL(src)
        }
      },
      'tbody tr'
    )
    log('info',"Nombre de documents récéupérés pour l'année : " + UneAnnee.annee + " : " + DocAnnee.length)
    ListeDocs.push(...DocAnnee.map(doc => ({
      ...doc,
      filename: doc.filename + '_' + this.formatDate(doc.date, UneAnnee.annee) + '.pdf',
      // the saveBills function needs a date field
      metadata: {
        // it can be interesting that we add the date of import. This is not mandatory but may be
        // useful for debugging or data migration
        importDate: new Date(),
        // document version, useful for migration after change of document structure
        version: 1
      }
    })))

  }
  log('info',"Nombre de documents total : " + ListeDocs.length)

  return ListeDocs
}

DateFromString(sDate)
{
  // sDate :  27/01/2008
  var regex = /([0-9]{2,4})/g
  var found = sDate.match(regex)
  return new Date(found[2] + '-' + found[1] + '-' + found[0])
}

// Convert a Date object to a ISO date string
formatDate(date, annee) {  
  
  let year = date.getFullYear()
  let month = date.getMonth() + 1
  let day = date.getDate()
  if (month < 10) {
    month = '0' + month
  }
  if (day < 10) {
    day = '0' + day
  }
  return annee + `_${year}-${month}-${day}`
}

}

var oConnecteur = new CGALRConnector()

oConnecteur.run()
